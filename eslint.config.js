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
        Timer: "readonly",
        print: "readonly"
      }
    }
  },
  {
    files: ["src/**/*.js", "scripts/**/*.js"],
    rules: {
      "sonarjs/cognitive-complexity": ["error", 10],
      "complexity": ["error", 8],
      "max-depth": ["error", 3],
      "max-lines-per-function": ["error", { max: 40, skipBlankLines: true, skipComments: true }]
    }
  },
  {
    ignores: ["node_modules/**"]
  }
];
