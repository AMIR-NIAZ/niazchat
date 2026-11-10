module.exports = {
    rootDir: '.',
    testEnvironment: 'node',
    roots: ['<rootDir>/mobile/src'],
    testMatch: ['<rootDir>/mobile/src/**/*.spec.ts'],
    moduleFileExtensions: ['ts', 'js', 'json'],
    transform: {
        '^.+\\.ts$': [
            'ts-jest',
            {
                tsconfig: '<rootDir>/mobile/tsconfig.json',
                isolatedModules: true,
                diagnostics: false,
            },
        ],
    },
};
