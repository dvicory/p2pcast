describe('Peer', function() {

  describe('#create()', function() {

    it('should throw if you create an empty peer', function(done) {
      Peer.create().exec(function(err, peer) {
	expect(err).to.exist;
	done();
      });
    });

  });

});