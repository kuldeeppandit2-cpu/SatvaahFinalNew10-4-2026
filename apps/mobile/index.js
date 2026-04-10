// SatvAAh entry point
// URL polyfill must be first — expo-asset loads URL.protocol before App.tsx
import './src/__stubs__/url-polyfill';
import { registerRootComponent } from 'expo';
import App from './App';
registerRootComponent(App);
