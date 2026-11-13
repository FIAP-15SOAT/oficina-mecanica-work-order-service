module.exports = {
  default: {
    paths: ['test/bdd/features/**/*.feature'],
    requireModule: ['ts-node/register', 'tsconfig-paths/register'],
    require: ['test/bdd/support/**/*.ts', 'test/bdd/steps/**/*.ts'],
    format: ['progress', ['html', 'reports/bdd/cucumber-report.html']],
  },
};
