function expandPost (hash) {
  // If hash is an empty string then select first blog
  var blogId = hash.slice(1) || document.querySelector('.article-wrapper h1').id;
  document.getElementById(blogId + '-cb').checked = true;
}

expandPost(window.location.hash);

Array.forEach(document.querySelectorAll('.blog article p a'), function (element) {
  element.target = '_blank';
});

Array.forEach(document.querySelectorAll('.blog .icon.link'), function (element) {
  element.onclick = function () {
    expandPost(element.getAttribute('href'));
  };
});
