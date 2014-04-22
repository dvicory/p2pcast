// Change color of flash message based on status of updated info
if($('#flash').text() == "updated successfully") {
  $('#flash').attr('style','color: green;');
}


// Channel management dialog box
$('.modifyChannel').click(function(e) {
	$('#myModal').modal('show');
	//console.log($(this).data('channel-name'));
	var name = $(this).data('channel-name');
	var description = $(this).data('channel-description');
	$('#channelName').val(name);
	$('#channelDescription').val(description);

});