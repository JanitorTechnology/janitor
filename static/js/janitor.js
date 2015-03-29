

// Alpha sign-up form.

var form = document.querySelector('.signup-form');
var email = document.querySelector('#signup-email');
var submit = document.querySelector('#signup-button');

function formStatus (status) {
  form.classList.remove('has-success', 'has-error');
  switch (status) {
    case 'success':
      form.classList.add('has-success');
      break;
    case 'error':
      form.classList.add('has-error');
      submit.classList.remove('disabled');
      break;
    default:
      submit.classList.remove('disabled');
  }
}

email.addEventListener('change', formStatus);
email.addEventListener('keydown', formStatus);

Scout('.signup-form').on('submit', function (query) {
  query.action = 'signup';

  query.data = {
    email: email.value
  };

  submit.classList.add('disabled');

  query.resp = function (data) {
    if (data.status === 'added' || data.status === 'already-added') {
      formStatus('success');
    } else {
      formStatus('error');
    }
  };
});
