/**
 * Bootstrap
 *
 * An asynchronous bootstrap function that runs before your Sails app gets lifted.
 * This gives you an opportunity to set up your data model, run jobs, or perform some special logic.
 *
 * For more information on bootstrapping your app, check out:
 * http://sailsjs.org/#documentation
 */

var _ = require('lodash');
var Promise = require('bluebird');

module.exports.bootstrap = function (cb) {
  // let's promisify everything
  _.forOwn(sails.models, function(model) {
    Promise.promisifyAll(model);
  });

  // let's be evil and replace waterline's toPromise with bluebird
  require('waterline/lib/waterline/query/deferred').prototype.toPromise = function() {
    var deferred = Promise.defer();
    this.exec(deferred.callback);
    return deferred.promise;
  };

  // It's very important to trigger this callack method when you are finished
  // with the bootstrap!  (otherwise your server will never lift, since it's waiting on the bootstrap)
  cb();
};