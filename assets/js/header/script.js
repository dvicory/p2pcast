//Toggle dropdown to show flash message if there was a problem with login
if($('#flash').text().length > 0){
  $('#loginmenu').addClass('open');
}

// Handle logout redirect
$('#logout').click(function() {
 $.post(
  '/logout',
    function(){
      location.reload(true);
    }
  );
});