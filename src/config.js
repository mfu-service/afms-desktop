'use strict';

const APP_URL = process.env.AFMS_URL || 'https://ft-edugate.univ-eloued.dz/';

function hostOf(value) {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return '';
  }
}

const APP_HOST = hostOf(APP_URL);

module.exports = {
  APP_URL,
  APP_HOST,
  APP_TITLE: 'AFMS — نظام إدارة الكلية الجامعية',
  ALLOWED_HOST_SUFFIXES: [APP_HOST, 'univ-eloued.dz'].filter(Boolean),
};
