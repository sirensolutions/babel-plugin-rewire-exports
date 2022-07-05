var spam = function spam() {
  return {
    eggs: function eggs() {
      _eggs();
    }
  };
};

export { spam };

var _eggs = function eggs() {};

export { _eggs as eggs };
var _spam = spam,
    _eggs2 = _eggs;
export function rewire$spam($stub) {
  spam = $stub;
}
export function rewire$eggs($stub) {
  _eggs = $stub;
}
export default function restore() {
  spam = _spam;
  _eggs = _eggs2;
}
