const sonarjs = require("eslint-plugin-sonarjs");

module.exports = [
  sonarjs.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: {
        console: "readonly",
        process: "readonly",
        require: "readonly",
        module: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
        fetch: "readonly",
        AbortSignal: "readonly",
        Shelly: "readonly",
        print: "readonly"
      }
    }
  },
  {
    ignores: ["node_modules/**"]
  }
];
