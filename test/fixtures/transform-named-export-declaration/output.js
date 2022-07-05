export var foo;
var _foo = foo;
export function rewire$foo($stub) {
  foo = $stub;
}
export default function restore() {
  foo = _foo;
}
