'use strict';

var FStarMain = require('./main');

var TextEditor = require('atom').TextEditor;

module.exports = {
  config: {
    panelVisibility: {
      title: 'Build Panel Visibility',
      type: 'string',
      default: 'Off',
      enum: [ 'On', 'Off' ],
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

    this.editorRegistry = {};

    atom.workspace.observeTextEditors((function(editor) {
      if(this.editorRegistry[editor.getPath()] === undefined) {
        var main = new FStarMain(editor);
        this.editorRegistry[editor.getPath()] = main;
        editor.onDidChangeCursorPosition(main.handleCursorChange.bind(main));
        editor.onDidDestroy(function() {
          this.editorRegistry[editor.getPath()].deactivate();
          this.editorRegistry[editor.getPath()] = undefined;
        }.bind(this));
      }
    }).bind(this));

    this.currentBuildView = undefined;
    atom.workspace.onDidChangeActivePaneItem(function(item) {
      if(this.currentBuildView) { this.currentBuildView.detach(); }
      if(item instanceof TextEditor) {
        if(atom.config.get('fstar-interactive.panelVisibility') === 'On') {
          this.currentBuildView =
            this.editorRegistry[item.getPath()].showBuildView();
        }
      }
    }.bind(this));

    atom.commands.add('atom-workspace', 'fstar-interactive:trigger',  function(){
      var editor = atom.workspace.getActiveTextEditor();
      if(editor) {
        this.editorRegistry[editor.getPath()].checkTillCurrentCursor();
      }
    }.bind(this));

    atom.commands.add('atom-workspace', 'fstar-interactive:gotoandtrigger',  function(){
      var editor = atom.workspace.getActiveTextEditor();
      if(editor) {
        this.editorRegistry[editor.getPath()].findMarkerAndCheck();
      }
    }.bind(this));

    atom.commands.add('atom-workspace', 'fstar-interactive:next-error',  function(){
      var editor = atom.workspace.getActiveTextEditor();
      if(editor) {
        this.editorRegistry[editor.getPath()].nextError();
      }
    }.bind(this));

    atom.commands.add('atom-workspace', 'fstar-interactive:stop',  function(){
      var editor = atom.workspace.getActiveTextEditor();
      if(editor) {
        this.editorRegistry[editor.getPath()].stop();
      }
    }.bind(this));

    atom.commands.add('atom-workspace', 'fstar-interactive:stopall',  function(){
      var self = this;
      Object.getOwnPropertyNames(self.editorRegistry).forEach(
        function(key) {
          if(self.editorRegistry[key] !== undefined) {
            self.editorRegistry[key].stop();
          }
        }
      );
    }.bind(this));

    atom.config.observe('fstar-interactive.panelVisibility', function(val) {
      switch (val) {
        //case 'Toggle':
        //case 'Show on Error':
          /*if (!this.title.hasClass('error')) {
            this.detach();
          }*/
        //break;
        case 'On':
          var editor = atom.workspace.getActiveTextEditor();
          if(editor) {
            this.currentBuildView = this.editorRegistry[editor.getPath()].showBuildView();
          }
          break;
        case 'Off':
          if(this.currentBuildView) { this.currentBuildView.detach(); }
          break;
      }
    }.bind(this));

    atom.commands.add('atom-workspace', 'fstar-interactive:all-errors',  function(){
      var editor = atom.workspace.getActiveTextEditor();
      if(editor) {
        if(this.currentBuildView) { this.currentBuildView.detach(); }
        this.currentBuildView =
          this.editorRegistry[editor.getPath()].showBuildView(true);
      }
    }.bind(this));
  },

  deactivate: function() {
    var self = this;
    Object.getOwnPropertyNames(self.editorRegistry).forEach(
      function(key) {
        if(self.editorRegistry[key] !== undefined) {
          self.editorRegistry[key].deactivate();
        }
      }
    );
    self.editorRegistry = undefined;
    self.currentBuildView = undefined;
  }
};
