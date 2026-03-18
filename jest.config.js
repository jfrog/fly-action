module.exports = {
  testEnvironment: 'node',
  transform: {
    '^.+\\.ts$': 'ts-jest',
    'node_modules/@actions/.+\\.js$': ['ts-jest', { tsconfig: { allowJs: true, esModuleInterop: true } }],
  },
  moduleNameMapper: {
    '^@actions/core$': '<rootDir>/node_modules/@actions/core/lib/core.js',
    '^@actions/exec$': '<rootDir>/node_modules/@actions/exec/lib/exec.js',
    '^@actions/http-client$': '<rootDir>/node_modules/@actions/http-client/lib/index.js',
    '^@actions/io$': '<rootDir>/node_modules/@actions/io/lib/io.js',
    '^@actions/(.+)/lib/(.+)$': '<rootDir>/node_modules/@actions/$1/lib/$2',
  },
  transformIgnorePatterns: [
    'node_modules/(?!@actions/)',
  ],
  testPathIgnorePatterns: ['<rootDir>/dist/', '<rootDir>/lib/'],
  moduleFileExtensions: ['ts', 'js', 'json', 'node'],
  testRegex: '(/__tests__/.*|(\\.|/)(test|spec))\\.(ts|js)$',
  collectCoverage: true,
  coverageDirectory: 'coverage',
  preset: 'ts-jest',
};