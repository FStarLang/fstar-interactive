'use strict';

var child_process = require('child_process');
var fs = require('fs');
var path = require('path');
var _ = require('lodash');
var XRegExp = require('xregexp').XRegExp;

var BuildView = require('./build-view');
var MessageBubble = require ("./messageBubble");

module.exports = {
  config: {
    panelVisibility: {
      title: 'Panel Visibility',
      description: 'Set when the build panel should be visible.',
      type: 'string',
      default: 'Toggle',
      enum: [ 'Toggle', 'Keep Visible', 'Show on Error' ],
      order: 1
    },
    monocleHeight: {
      title: 'Monocle Height',
      description: 'How much of the workspace to use for build panel when it is "maximized".',
      type: 'number',
      default: 0.75,
      minimum: 0.1,
      maximum: 0.9,
      order: 4
    },
    minimizedHeight: {
      title: 'Minimized Height',
      description: 'How much of the workspace to use for build panel when it is "minimized".',
      type: 'number',
      default: 0.15,
      minimum: 0.1,
      maximum: 0.9,
      order: 5
    }
  },

  activate: function(state) {
    this.debug = true;
    console.log("Activating F* interactive!");
    this.buildView = new BuildView();
    this.cmd = {};
    this.match = [];
    this.stdout = new Buffer(0);
    this.stderr = new Buffer(0);
    atom.commands.add('atom-workspace', 'fstar-interactive:trigger',      this.checkSelection.bind(this));
    atom.commands.add('atom-workspace', 'fstar-interactive:next-error',   this.nextError.bind(this));
    atom.commands.add('atom-workspace', 'fstar-interactive:stop',         this.stop.bind(this));
    atom.commands.add('atom-workspace', 'fstar-interactive:all-errors',   this.showBuildView.bind(this));
  },

  deactivate: function() {
    if (this.child) {
      this.child.kill('SIGKILL');
    }
    clearTimeout(this.finishedTimer);
  },

  cwd : function () {
     var textEditor = atom.workspace.getActiveTextEditor();
     if (textEditor && 'untitled' !== textEditor.getTitle()) {
         var activeFile = fs.realpathSync(textEditor.getPath());
         return path.dirname(activeFile)
     }
  },

  // Parse this block out of the current file
  //(*--F*-interactive:
  //    ['foo.fst bar.fst --admit_fsi Bar']
  //  --*)
  fstarArgs : function () { //TODO
    return ['--in'];
  },

  buildCommand: function (batch) {
    return {
      exec:'fstar',
      args:this.fstarArgs(),
      cwd:this.cwd()
    };
  },

  onStdout: function (buffer) {
    this.stdout = Buffer.concat([ this.stdout, buffer ]);
    this.buildView.append(buffer);
    if (buffer && this.lastDecoration) {
      var str = buffer.toString().trim();
      if (str.endsWith("#ok")) {
        this.lastDecoration.setProperties({type:'line', class:'line-checked'});
      } else if (str.endsWith("#fail")) {
        this.lastDecoration.setProperties({type:'line', class:'line-check-failed'});
        var marker = this.lastDecoration.getMarker();
        var _this = this;
        this.highlightErrors();
        setTimeout(function () { _this.popMarker(_this, marker)({check_failed:true}); },
                   500);
      }
    }
    if (this.debug) {
      console.log(buffer.toString());
    }
  },

  onStderr: function (buffer) {
    this.stderr = Buffer.concat([ this.stderr, buffer ]);
    this.buildView.append(buffer);
    this.buildView.show();
  },

  onError: function(err) {
    this.buildView.append((this.cmd.sh ? 'Unable to execute with sh: ' : 'Unable to execute: ') + this.cmd.exec);
    this.buildView.append(/\s/.test(this.cmd.exec) ? '`cmd` cannot contain space. Use `args` for arguments.' : '');
    this.buildView.show();
  },

  onClose: function(exitCode) {
    this.buildView.buildFinished(0 === exitCode);
    if (0 === exitCode) {
      this.finishedTimer = setTimeout(function() {
        this.buildView.detach();
      }.bind(this), 1000);
    }
    this.child = null;
    this.clearAllMarkers();
  },

  startChildProcess: function(batch) {
    var cmd = this.buildCommand(batch);
    this.child = child_process.spawn(
      cmd.exec,
      cmd.args,
      { cwd: cmd.cwd }
    );

    this.stdout = new Buffer(0);
    this.stderr = new Buffer(0);

    this.child.stdout.on('data', this.onStdout.bind(this));
    this.child.stderr.on('data', this.onStderr.bind(this));
    this.child.on('error', this.onError.bind(this));
    this.child.on('close', this.onClose.bind(this));

    if (this.debug) {
      console.log(this.cmd.exec + [ ' ' ].concat(this.cmd.args).join(' '));
    }
  },

  clearAllMarkers: function () {
      if (this.markers) {
        this.markers.forEach(function (marker) { if (marker && !marker.isDestroyed()) { marker.destroy(); } } );
        this.markers=undefined;
      }
  },

  popMarker : function (_this, marker) {
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
  },

  //The main function
  checkSelection: function() {
    this.stdout = new Buffer(0);
    this.stderr = new Buffer(0);
    this.buildView.reset();
    if (!this.child) {
      this.startChildProcess();
    }
    var editor = atom.workspace.getActiveTextEditor();
    if (!this.markers) {
      var start = [[0,0], [0,0]];
      this.markers = [editor.markBufferRange(start, {invalidate:'never'})];
    }

    var lastMarker = this.markers[0];
    var currentPos = editor.getCursorBufferPosition();

    if (this.debug) {
      console.log("currentPos is " +currentPos);
      console.log("lastMarker end is " +lastMarker.getEndBufferPosition());
    }

    var nextRange = [lastMarker.getEndBufferPosition(), currentPos];

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

    this.child.stdin.write("#push\n");
    this.child.stdin.write(code);
    this.child.stdin.write("\n");
    this.child.stdin.write("#end #ok #fail\n");
  },

  parseAllErrors : function () {
    var lines = this.stdout.toString().split("\n");
    var errors=[];
    var err =
      XRegExp('(?<source>  [^\\(]+) \\(' +
              '(?<lstart>   [0-9]+) ,' +
              '(?<rstart>   [0-9]+) -' +
              '(?<lend>     [0-9]+) ,' +
              '(?<rend>     [0-9]+) \\):' +
              '(?<message>  .*)', 'x');
    lines.forEach(function (line) {
        var e = XRegExp.exec(line, err, 0, true);
        if (e) {
          errors.push(e);
        } else {
          console.log("Not an error line : <" +line+ ">");
        }});
    this.errors = errors;
  },

  logError : function (err) {
      console.log("ERROR!:\n" +err.toString());
  },

  errorBufferRange : function (err) {
    var base = this.markers[0];
    if (!base) return;
    var basePos = base.getStartBufferPosition();
    var start = basePos.translate([+err.lstart - 1, +err.rstart]);
    var end = basePos.translate([+err.lend - 1, +err.rend]);
    return [start, end];
  },

  highlightErrors : function () {
    this.parseAllErrors();
    var base = this.markers[0];
    if (!base) return;
    var editor = atom.workspace.getActiveTextEditor();
    var _this = this;
    this.errors.forEach(function (err) {
        if (err.source = "<input>") {
            _this.logError(err);
            var errRange = _this.errorBufferRange(err);
            var errMarker = editor.markBufferRange(errRange, {invalidate:'touch'});
            errMarker.onDidChange(function () { errMarker.destroy(); });
            console.log("Marking region: " +(errRange) + "\n marker range is " + errMarker.getBufferRange());
            console.log("Text of region is [" + editor.getTextInBufferRange(errMarker.getBufferRange()) +  "]");
            editor.decorateMarker(errMarker,
              {type:'highlight', class:'highlight-squiggly'});
            editor.decorateMarker(errMarker,
              {type:'line-number', class:'line-number-red'});
            var mb = new MessageBubble();
            mb.append(err.message.trim());
            editor.decorateMarker(errMarker,
              {type:'overlay', item: mb});
        }
    });
  },

  nextError : function () {
      var nextError = this.errors.shift();
      var rng = this.errorBufferRange(nextError);
      this.errors.push(nextError);
      var textEditor = atom.workspace.getActiveTextEditor();
      if (nextError.source === "<input>") { //current file
          textEditor.setCursorBufferPosition(rng[0]);
      }
      else {
       atom.workspace.open(this.cwd() + "/" + nextError.source, {
          initialLine: rng[0][0],
          initialColumn: rng[0][1]
        });
      }
  },

  showBuildView : function () {
    this.buildView.show();
  },

  abort: function(cb) {
    this.child.removeAllListeners('close');
    this.child.on('close', function() {
      this.child = null;
      if (cb) {
        cb();
      }
    }.bind(this));
    this.child.kill();
    this.child.killed = true;
    this.clearAllMarkers();
  },

  stop: function() {

    clearTimeout(this.finishedTimer);
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
  }
};
