var foo = function foo() {
  return null;
};

export { foo };
var _foo = foo;
export function rewire$foo($stub) {
  foo = $stub;
}
export function restore() {
  foo = _foo;
}
