const exportObject = {
  value: 'Test value'
};
const {
  value: testValue
} = exportObject;
var _testValue = testValue;
export { _testValue as testValue };
export function rewire$testValue($stub) {
  _testValue = $stub;
}
export default function restore() {
  _testValue = testValue;
}
