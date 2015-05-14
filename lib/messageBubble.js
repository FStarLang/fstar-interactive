'use strict';

var _ = require('lodash');
var View = require('atom-space-pen-views').View;
var cscompatability = require('./cscompatability');
var Convert = require('ansi-to-html');

module.exports = (function() {
  function MessageBubble() {
    View.apply(this, arguments);
    this.a2h = new Convert();
  }

  cscompatability.extends(MessageBubble, View);

  MessageBubble.content = function() {
      MessageBubble.div(function() {
        MessageBubble.ol({ class: 'error-message', outlet: 'output' });
      });
  };

  MessageBubble.prototype.append = function(line) {
    line = _.escape(line.toString());
    this.output.append(this.a2h.toHtml(line));
  };

  return MessageBubble;
})();
