// Polyfill for react-native-get-random-values
// crypto.getRandomValues is available in Hermes/JSC
if (typeof global.crypto === 'undefined') {
  (global as any).crypto = {};
}
if (typeof global.crypto.getRandomValues === 'undefined') {
  (global as any).crypto.getRandomValues = (array: Uint8Array) => {
    for (let i = 0; i < array.length; i++) {
      array[i] = Math.floor(Math.random() * 256);
    }
    return array;
  };
}
export {};
