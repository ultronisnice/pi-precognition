// Compat shim: the deep test suite imports from "../extensions/precognition.ts".
// The canonical package entry is "../src/index.ts" — this file re-exports it
// so the test paths stay short. End users importing the package should use
// the package entry directly, not this shim.
export { default } from "../src/index.ts";
