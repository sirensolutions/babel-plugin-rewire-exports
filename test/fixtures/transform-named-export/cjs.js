"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.rewire$foo = rewire$foo;
exports["default"] = restore;
exports.foo = void 0;
var foo;
exports.foo = foo;
var _foo = foo;

function rewire$foo($stub) {
  exports.foo = foo = $stub;
}

function restore() {
  exports.foo = foo = _foo;
}
