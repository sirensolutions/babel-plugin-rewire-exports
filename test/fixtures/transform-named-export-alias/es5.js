var foo;
export { foo as bar };
var _bar = foo;
export function rewire$bar($stub) {
  foo = $stub;
}
export default function restore() {
  foo = _bar;
}
