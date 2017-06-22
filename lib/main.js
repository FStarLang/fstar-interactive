'use strict';

var child_process = require('child_process');
var BuildView = require('./build-view');
var MessageBubble = require ("./messageBubble");

var fs = require('fs');
var path = require('path');
var _ = require('lodash');
var XRegExp = require('xregexp').XRegExp;

module.exports = (function(){
  function FStarMain(editor) {
    this.editor = editor;

    this.child = undefined;

    this.buildView = new BuildView();

    this.lastDecoration = undefined;
    this.stdout = new Buffer(0);
    this.stderr = new Buffer(0);
    // this looks a bit fishy
    this.cmd = {};

    this.markers = undefined;
    this.errorMarkers = undefined;
    this.errors = undefined;

    this.currentDecoration = undefined;
  }

  FStarMain.prototype.handleCursorChange = function(ev) {
    var self = this;

    if(self.currentDecoration) {
      self.currentDecoration.destroy();
      self.currentDecoration = undefined;
    }

    if(self.errorMarkers && self.errorMarkers.length > 0) {
      var allContainingMarkers =
        self.errorMarkers.filter(function(curr, index, arr) {
          return curr.marker.getBufferRange().containsPoint(ev.newBufferPosition);
        });
      if(allContainingMarkers.length > 0) {
        var m =
          allContainingMarkers.reduce(function(accum, curr, index, arr) {
            var cmp = curr.marker.getBufferRange()
                                 .compare(accum.marker.getBufferRange());
            return (cmp === 1 ? curr : accum);
          });
        var bubble = new MessageBubble();
        bubble.append(m.msg);
        self.currentDecoration =
          self.editor.decorateMarker
            (m.marker, {type:'overlay', item: bubble});
        self.currentDecoration.onDidDestroy
          (function() { self.currentDecoration = undefined; });
      }
    }
  };

  FStarMain.prototype.deactivate = function() {
    if (this.child) {
      this.child.kill('SIGKILL');
    }
    this.editor = undefined;
    this.stop();
    clearTimeout(this.finishedTimer);
  };

  FStarMain.prototype.showBuildView = function(force) {
    var show = force ||
                atom.config.get('fstar-interactive.panelVisibility') === 'On';
    if(show) {
      this.buildView.show();
    }
    return this.buildView;
  };

  FStarMain.prototype.hideBuildView = function() {
    //this.buildView.detach();
  }

  FStarMain.prototype.cwd = function() {
     var textEditor = this.editor;
     if (textEditor && 'untitled' !== textEditor.getTitle()) {
         var activeFile = fs.realpathSync(textEditor.getPath());
         return path.dirname(activeFile)
     }
  };

  // Tries to call `make FILE-in` to get F* arguments
  // If this fails, tries instead to parse this block out of the current file:
  // (*--build-config
  // ...
  // --*)
  FStarMain.prototype.fstarArgs = function() {
    var editor = this.editor;
    var file = fs.realpathSync(editor.getPath());
    var filename = path.basename(file);
    var filepath = path.dirname(file);
    var config = null;
    var fstar_args = ["--in", filename];

    try {
      config = child_process.execSync("make --quiet "+filename+"-in",
                 {cwd: filepath, timeout: 2000}).toString();
      console.log("Interactive mode options: "+config);
      config = config.split(' ');
    }
    catch(e) {
      console.log("Failed to use Makefile for build config: "+e);
    }

    if (config !== null) {
      return {
        args: fstar_args.concat(config),
        cwd: filepath
      };
    }
    
    var bc = /[(][*][-][-]build[-]config([\s\S]*)--[*][)]/.exec(editor.getText());
    if(bc !== null) {
      bc = bc[1];
      console.log("about to parse: " +bc);
      var lines = bc.split(";");

      var options = [];
      var variables = [];
      var files = [];
      lines.forEach (function (l) {
        console.log(">>>" +l);
        var l = l.trim();
        var fn = l.split(":");
        if(fn && fn[1]) {
          fn[1] = fn[1].trim();
          if(fn[1] === "") { return; }
        }
        if (fn) {
          if (fn[0] === "options") {
            options = options.concat(fn[1].split(' '));
          }
          if (fn[0]==="variables") {
            var vars = fn[1].split(' ');
            vars = vars.map(function (xv) {
              return xv.trim().split('=');
            });
            variables = variables.concat(vars.filter(function (xv) { if (xv) { return (xv[0] && xv[0] !== ""); }}));
          }
          if (fn[0]==="other-files") {
            files = files.concat(fn[1].split(' ').map(function (s) { return s.trim(); }).filter(function (f) { return  f !== ""; }));
          }
        }
      });

      console.log("Parsed build config: <" + options + "\n " +variables+ "\n " + files + ">");
      variables.forEach(function (v) {
        console.log("replacing $" +v[0] +" with " +v[1]);
        files = files.map(function (x) { return x.replace("$"+v[0], v[1]); });
      });

      console.log("After replacement: <" + files + ">");
      return {
        args: fstar_args.concat(options, files),
        cwd: filepath
      };
    }

    return {
        args: fstar_args,
        cwd: filepath
    };
  };

  FStarMain.prototype.buildCommand = function(batch) {
    var args = this.fstarArgs();
    console.log("Build command: " +args.args + "\n cwd = " + args.cwd);
    return {
      exec:'fstar.exe',
      args:args.args,
      cwd:args.cwd,
      pp: args.pp
    };
  };

  FStarMain.prototype.onStdout = function(buffer) {
    this.stdout = Buffer.concat([ this.stdout, buffer ]);
    this.buildView.append(buffer);
    if (buffer && this.lastDecoration) {
      var str = buffer.toString().trim();
      if (str.endsWith("#ok")) {
        this.buildView.buildFinished(true);
        this.lastDecoration.setProperties({type:'line', class:'line-checked'});
      } else if (str.endsWith("#fail")) {
        this.buildView.buildFinished(false);
        this.lastDecoration.setProperties({type:'line', class:'line-check-failed'});
        var marker = this.lastDecoration.getMarker();
        var _this = this;
        this.highlightErrors();
        setTimeout(function () { _this.popMarker(_this, marker)({check_failed:true}); },
                   500);
      }
    }
    console.log(buffer.toString());
  };

  FStarMain.prototype.onStderr = function(buffer) {
    this.stderr = Buffer.concat([ this.stderr, buffer ]);
    this.buildView.append(buffer);
    this.showBuildView();
  };

  FStarMain.prototype.onError = function(err) {
    this.buildView.append((this.cmd.sh ? 'Unable to execute with sh: ' : 'Unable to execute: ') + this.cmd.exec);
    this.buildView.append(/\s/.test(this.cmd.exec) ? '`cmd` cannot contain space. Use `args` for arguments.' : '');
    this.showBuildView();
  };

  FStarMain.prototype.onClose = function(exitCode) {
    this.buildView.buildFinished(0 === exitCode);
    if (0 === exitCode) {
      this.finishedTimer = setTimeout(function() {
        this.buildView.detach();
      }.bind(this), 1000);
    }
    this.child = null;
    this.clearAllMarkers();
  };

  FStarMain.prototype.startChildProcess = function(batch) {
    var cmd = this.buildCommand(batch);
    var _this = this;
    var spawn_main_process = function () {
      console.log("Calling process with args: <" + cmd.args + ">");
      _this.child = child_process.spawn(
        cmd.exec,
        cmd.args,
        { cwd: cmd.cwd }
      );

      _this.stdout = new Buffer(0);
      _this.stderr = new Buffer(0);

      _this.child.stdout.on('data', _this.onStdout.bind(_this));
      _this.child.stderr.on('data', _this.onStderr.bind(_this));
      _this.child.on('error', _this.onError.bind(_this));
      _this.child.on('close', _this.onClose.bind(_this));
    };

    if (cmd.pp) {
        var pp = child_process.spawn(cmd.pp.cmd, cmd.pp.args, {cwd:cmd.cwd});
        pp.on('exit', function (ex) {
          if (ex.code == 0) {
            spawn_main_process();
          } else {
            _this.buildView.append("Preprocessing failed");
            _this.showBuildView();
          }
        });
    } else {
       spawn_main_process();
    }


    // this is always printing undefined, this.cmd is not set anywhere
    /*if (this.debug) {
      console.log(this.cmd.exec + [ ' ' ].concat(this.cmd.args).join(' '));
    }*/
  };

  FStarMain.prototype.clearAllMarkers = function() {
    if(this.markers) {
      this.markers.forEach(function(marker) { if(marker && !marker.isDestroyed()) { marker.destroy(); } } );
      this.markers=undefined;
    }
    if(this.errorMarkers) {
      this.errorMarkers.forEach(function(m) { m.marker.destroy(); });
      this.errorMarkers = [];
    }
  };

  FStarMain.prototype.popMarker = function(_this, marker) {
    return function (ev) {

      if (marker.already_popped) {
        return;
      }
      if (!ev.textChanged && !ev.check_failed) {
        return;
      }
      if (!_this.child) {
        return;
      }
      //  _this.buildView.append("Calling popMarker on " +marker);
      while (true) {
        var m = _this.markers.shift();
        _this.child.stdin.write("#pop\n");
        if (!m.isDestroyed()) {
          m.already_popped = true;
          m.destroy();
        }
        if (m === marker) {
          return;
        }
      }
    };
  };

  FStarMain.prototype.checkTillCurrentCursor = function() {
    this.checkSelection(false);
  };

  FStarMain.prototype.findMarkerAndCheck = function() {
    this.checkSelection(true);
  };

  //The main function
  FStarMain.prototype.checkSelection = function(find) {
    this.stdout = new Buffer(0);
    this.stderr = new Buffer(0);
    this.errors = [];
    if (this.errorMarkers) {
      this.errorMarkers.forEach(function (m) { m.marker.destroy(); });
      this.errorMarkers = undefined;
    }
    this.buildView.reset();
    if (!this.child) {
      this.startChildProcess();
    }
    var editor = this.editor;
    if (!this.markers) {
      var start = [[0,0], [0,0]];
      this.markers = [editor.markBufferRange(start, {invalidate:'never'})];
    }

    var lastMarker = this.markers[0];
    var currentPos = editor.getCursorBufferPosition();
    var fallbackPos = currentPos.copy();

    if(find) {
      while(true) {
        var txt = editor.lineTextForBufferRow(currentPos.row);
        if(txt === undefined) {
          console.log("Falling back to original pos: " + fallbackPos);
          currentPos = fallbackPos;
          break;
        }
        if(txt.trim() === "(* check_marker *)") {
          console.log("Found the marker");
          break;
        }
        ++currentPos.row;
        currentPos.column = 0;
      }
    }

    editor.setCursorBufferPosition([fallbackPos.row, fallbackPos.column]);

    if (this.debug) {
      console.log("currentPos is " +currentPos);
      console.log("lastMarker end is " +lastMarker.getEndBufferPosition());
    }

    var nextRange = [lastMarker.getEndBufferPosition(), currentPos];
    if (nextRange[0].isGreaterThanOrEqual(currentPos)) {//do nothing ... can only progress forward
      return;
    }

    if (this.debug) {
      console.log("nextRange is " +nextRange.toString());
    }

    var nextMarker = editor.markBufferRange(nextRange, {invalidate:'inside', persistent:'false'});
    this.markers.unshift(nextMarker);
    nextMarker.onDidChange(this.popMarker(this, nextMarker));
    var decoration = editor.decorateMarker(nextMarker, {type:'line', class:'line-checking'});
    var code = editor.getTextInBufferRange(nextRange);
    this.lastDecoration = decoration;

    if (this.debug) {
      console.log("Sending selection to process:\n" + code);
    }
    this.buildView.buildStarted();
    this.child.stdin.write("#push\n");
    this.child.stdin.write(code);
    this.child.stdin.write("\n");
    this.child.stdin.write("#end #ok #fail\n");
  };

  FStarMain.prototype.parseAllErrors = function() {
    var lines = this.stdout.toString().split("\n");
    var errors=[];
    var err =
      XRegExp('(?<source>  [^\\(]+) \\(' +
              '(?<lstart>   [0-9]+) ,' +
              '(?<rstart>   [0-9]+) -' +
              '(?<lend>     [0-9]+) ,' +
              '(?<rend>     [0-9]+) \\):' +
              '(?<message>  .*)', 'x');
    lines.forEach(function(line) {
        var e = XRegExp.exec(line, err, 0, true);
        if (e) {
          errors.push(e);
        } else {
          console.log("Not an error line : <" +line+ ">");
        }});
    this.errors = errors;
  };

  FStarMain.prototype.logError = function(err) {
    console.log("ERROR!:\n" + err.toString());
  };

  FStarMain.prototype.errorBufferRange = function(err) {
    var base = this.markers[0];
    if (!base) return;
    var basePos = base.getStartBufferPosition();
    var start = basePos.translate([+err.lstart - 1, +err.rstart]);
    var end = basePos.translate([+err.lend - 1, +err.rend]);
    return [start, end];
  };

  FStarMain.prototype.highlightErrors = function() {
    this.parseAllErrors();
    var base = this.markers[0];
    if (!base) return;
    var editor = this.editor;
    var _this = this;
    this.errorMarkers = [];
    this.errors.forEach(function (err) {
      if (err.source = "<input>") {
        _this.logError(err);
        var errRange = _this.errorBufferRange(err);
        if(errRange[0].row === errRange[1].row &&
           errRange[0].column === errRange[1].column) { // case of syntax errors
          ++errRange[1].column;
        }
        var errMarker = editor.markBufferRange(errRange, {invalidate:'touch'});
        _this.errorMarkers.push({marker:errMarker, msg:err.message.trim()});

        // this should use some kind of map
        errMarker.onDidChange(function () {
          var old_markers = _this.errorMarkers;
          var new_markers = [];
          old_markers.forEach(function(m) {
            if(m.marker !== errMarker) {
              new_markers.push(m);
            }
          });
          _this.errorMarkers = new_markers;
          errMarker.destroy();
        });

        console.log("Marking region: " +(errRange) + "\n marker range is " + errMarker.getBufferRange());
        console.log("Text of region is [" + editor.getTextInBufferRange(errMarker.getBufferRange()) +  "]");
        editor.decorateMarker(errMarker,
          {type:'line-number', class:'line-number-red'});
        editor.decorateMarker(errMarker,
        {type:'highlight', class:'highlight-squiggly'});
      }
    });
  };

  FStarMain.prototype.nextError = function() {
    if (!this.errorMarkers || !this.errors) return;
    var nextErrorMarker = this.errorMarkers.shift();
    this.errorMarkers.push(nextErrorMarker);
    var nextError = this.errors.shift();
    this.errors.push(nextError);
    var textEditor = this.editor;
    if (nextError.source === "<input>") { //current file
        textEditor.setCursorBufferPosition(nextErrorMarker.marker.getStartBufferPosition());
    }
    else {
     var rng = this.errorBufferRange(nextError);
     atom.workspace.open(this.cwd() + "/" + nextError.source, {
        initialLine: rng[0][0],
        initialColumn: rng[0][1]
      });
    }
  };

  FStarMain.prototype.abort = function(cb) {
    this.child.removeAllListeners('close');
    this.child.on('close', function() {
      this.child = null;
      if (cb) {
        cb();
      }
    }.bind(this));
    this.child.kill('SIGKILL');
    this.child.killed = true;
  };

  FStarMain.prototype.stop = function() {
    this.clearAllMarkers();
    if (this.child) {
      if (this.child.killed){
        // This child has been killed, but hasn't terminated. Hide it from user.
        this.child.removeAllListeners();
        this.child = null;
        this.buildView.buildAborted();
        return;
      }

      this.abort(this.buildView.buildAborted.bind(this.buildView));

      this.buildView.buildAbortInitiated();
    } else {
      this.buildView.reset();
    }
  };

  return FStarMain;
})();
