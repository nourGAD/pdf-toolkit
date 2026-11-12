import { registerRootComponent } from 'expo';
import { initCrashReporting, wrapApp } from './src/lib/crash';
import App from './App';

initCrashReporting();

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
registerRootComponent(wrapApp(App));
