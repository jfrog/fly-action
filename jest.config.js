module.exports = {
  testEnvironment: 'node',
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  testPathIgnorePatterns: ['<rootDir>/dist/', '<rootDir>/lib/'],
  moduleFileExtensions: ['ts', 'js', 'json', 'node'],
  testRegex: '(/__tests__/.*|(\\.|/)(test|spec))\\.(ts|js)$',
  collectCoverage: true,
  coverageDirectory: 'coverage',
  preset: 'ts-jest',
};