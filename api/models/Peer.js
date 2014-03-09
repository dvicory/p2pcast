/**
 * Peer.js
 *
 * @description :: Peer   
 * @docs		:: http://sailsjs.org/#!documentation/models
 */

var Peer = {

	attributes: {
		
		socketID: {
			type: 'string',
			unique: true,
			required: true	 
		},

		user: {
			model: 'User' 
		},
		
		channel: {
			model: 'Channel',
			required: true
		},

		broadcaster: {
			type: 'boolean',
			required: true
		},	

		parent: {
			model: 'Peer',
			required: true			
		},

		children: {
			collection: 'Peer',
			via: 'id'
		},
		
	},

	adapter: 'memory'	

};

module.exports = Peer;
