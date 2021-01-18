// Copyright © 2016 Team Janitor. All rights reserved.
// The following code is covered by the AGPL-3.0 license.

// Format milliseconds into human readable text.
window.formatTime = function (milliseconds) {
  const units = [
    { code: 'ms', max: 1000 },
    { code: 's', max: 60 },
    { code: 'min', max: 60 },
    { code: 'hours', max: 24 },
    { code: 'days', max: 365.25 },
    { code: 'years' }
  ];
  let unit = units.shift();
  let value = Number(milliseconds);

  while (unit.max && value >= unit.max) {
    value /= unit.max;
    unit = units.shift();
  }

  return (Math.round(value * 10) / 10) + ' ' + unit.code;
};

// Format bytes into human readable text.
window.formatMemory = function (bytes) {
  const prefix = ['', 'K', 'M', 'G', 'T', 'P', 'E', 'Z', 'Y'];
  let p = 0;
  let value = Number(bytes);

  while (value > 1024 && p < prefix.length) {
    value /= 1024;
    p++;
  }

  return (Math.round(value * 100) / 100) + ' ' + prefix[p] + 'B';
};

// Set-up all time series graphs.
Array.map(document.querySelectorAll('*[data-data]'), function (div) {
  const data = JSON.parse(div.dataset.data);
  const title = div.dataset.title;

  data.forEach(function (row) {
    row[0] = new Date(row[0]);
  });

  new window.Dygraph(div, data, {
    title: title,
    axes: {
      y: {
        valueFormatter: window.formatTime,
        axisLabelFormatter: window.formatTime,
        axisLabelWidth: 60,
        includeZero: true
      }
    },
    labelsUTC: true
  });
});
