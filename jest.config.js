module.exports = {
	testEnvironment: 'node',
	verbose: false,
	testMatch: [
		'**/test/*.js',
	],
	collectCoverage: true,
	coverageThreshold: {
		global: {
			statements: 38,
			branches: 21,
			functions: 50,
			lines: 39,
		},
	},
};
