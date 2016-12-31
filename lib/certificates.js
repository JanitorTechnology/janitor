// Copyright © 2016 Jan Keromnes. All rights reserved.
// The following code is covered by the AGPL-3.0 license.

let child_process = require('child_process');
let forge = require('node-forge');
let letsencrypt = require('le-acme-core');

// ACME protocol client to interact with the Let's Encrypt service.
let client = letsencrypt.ACME.create({
  rsaKeySize: 4096
});

// The URL prefix that Let's Encrypt will use to challenge our identity.
// Source: https://ietf-wg-acme.github.io/acme/#http
let letsEncryptChallengePrefix =
  letsencrypt.acmeChallengePrefix || '/.well-known/acme-challenge/';

// ACME protocol challenge tokens proving our identity to Let's Encrypt.
let letsEncryptChallenges = {};


// Verify if a given certificate in PEM format satisfies validity constraints.

function isValid (parameters, enableDebug) {

  let debug = () => {
    if (enableDebug) {
      console.error(...arguments);
    }
  };

  if (!parameters.crt) {
    debug('No certificate.');
    return false;
  }

  let certificate;
  try {
    certificate = forge.pki.certificateFromPem(parameters.crt);
  } catch (error) {
    debug('Invalid certificate.');
    return false;
  }

  // Consider that certificates expire 24h before they actually do.
  let padding = 24 * 3600 * 1000;
  let now = new Date();
  if (now.getTime() + padding >= certificate.validity.notAfter.getTime()) {
    debug('Certificate expired.');
    return false;
  }
  if (now < certificate.validity.notBefore) {
    debug('Certificate not valid yet. Or your system\'s clock is off.');
    return false;
  }

  if ('ca' in parameters) {
    try {
      let caStore = forge.pki.createCaStore(parameters.ca);
      if (!forge.pki.verifyCertificateChain(caStore, [ certificate ])) {
        debug('Certificate is not verified by the provided CA chain.');
        return false;
      }
    } catch (error) {
      debug('Problem during CA chain verification:', error);
      return false;
    }
  }

  if ('key' in parameters) {
    try {
      let privateKey = forge.pki.privateKeyFromPem(parameters.key);
      let md = forge.md.sha256.create();
      md.update('verify me', 'utf8');
      let signature = privateKey.sign(md);
      if (!certificate.publicKey.verify(md.digest().bytes(), signature)) {
        debug('Certificate doesn\'t match the provided RSA private key.');
        return false;
      }
    } catch (error) {
      debug('Problem during RSA private key verification:', error);
      return false;
    }
  }

  if ('hostname' in parameters) {
    let hostname = parameters.hostname;
    let commonName = certificate.subject.getField('CN').value;
    let altNames = [ commonName ];
    let subjectAltName = certificate.getExtension('subjectAltName');
    if (subjectAltName) {
      altNames = subjectAltName.altNames
        .filter(altName => altName.type === 2) // DNS
        .map(altName => altName.value);
    }
    if (altNames.indexOf(hostname) < 0) {
      debug('Certificate is not valid for hostname "' + hostname + '" ' +
        '(should be one of: "' + altNames.join('", "') + '").');
      return false;
    }
  }

  return true;

}

exports.isValid = isValid;


// Generate an RSA public and private key pair in forge format (binary).

function generateRSAKeyPair (callback) {

  // Generate a new 4096-bit RSA private key (up to 100x faster than forge).
  child_process.exec('openssl genrsa 4096', (error, stdout, stderr) => {

    if (error) {
      callback(error);
      return;
    }

    // Convert OpenSSL's PEM output format to binary forge representation.
    let privateKey = forge.pki.privateKeyFromPem(stdout);

    // Extract the public key from the private key.
    let publicKey = forge.pki.setRsaPublicKey(privateKey.n, privateKey.e);

    callback(null, {
      privateKey: privateKey,
      publicKey: publicKey
    });

  });

}

exports.generateRSAKeyPair = generateRSAKeyPair;


// Generate an SSH public and private key pair in OpenSSH format.

function createSSHKeyPair (callback) {

  generateRSAKeyPair((error, keypair) => {

    if (error) {
      callback(error);
      return;
    }

    let fingerprint = forge.ssh.getPublicKeyFingerprint(keypair.publicKey, {
      encoding: 'hex',
      delimiter: ':'
    });

    let sshKeyPair = {
      fingerprint: fingerprint,
      privateKey: forge.ssh.privateKeyToOpenSSH(keypair.privateKey),
      publicKey: forge.ssh.publicKeyToOpenSSH(keypair.publicKey)
    };

    callback(null, sshKeyPair);

  });

}

exports.createSSHKeyPair = createSSHKeyPair;


// Create a TLS certificate in PEM format.

function createTLSCertificate (parameters, callback) {

  let commonName = parameters.commonName;
  let altNames = parameters.altNames || [];
  let basicConstraints = parameters.basicConstraints || null;
  let keyUsage = parameters.keyUsage || null;
  let extKeyUsage = parameters.extKeyUsage || null;
  let key = parameters.key || null;
  let caCrt = parameters.caCrt || null;
  let caKey = parameters.caKey || null;

  let certificate = forge.pki.createCertificate();

  // Make the certificate valid for one year, starting now.
  let notBefore = new Date();
  let notAfter = new Date();
  notAfter.setFullYear(notBefore.getFullYear() + 1);

  certificate.validity.notBefore = notBefore;
  certificate.validity.notAfter = notAfter;

  let attributes = [{
    name: 'commonName',
    value: commonName
  }];

  certificate.setSubject(attributes);

  if (caCrt) {
    // Use the provided CA certificate to issue the certificate.
    let issuer = forge.pki.certificateFromPem(caCrt);
    certificate.setIssuer(issuer.subject.attributes);
  } else {
    // Issue a self-signed certificate.
    certificate.setIssuer(attributes);
  }

  if (altNames.indexOf(commonName) < 0) {
    altNames.unshift(commonName);
  }

  let extensions = [{
    name: 'subjectAltName',
    altNames: altNames.map((altName) => ({
      type: 2, // DNS
      value: altName
    }))
  }];

  if (basicConstraints) {
    extensions.push({
      name: 'basicConstraints',
      cA: basicConstraints.cA || false
    });
  }

  if (keyUsage) {
    extensions.push({
      name: 'keyUsage',
      keyCertSign: keyUsage.keyCertSign || false,
      digitalSignature: keyUsage.digitalSignature || false,
      nonRepudiation: keyUsage.nonRepudiation || false,
      keyEncipherment: keyUsage.keyEncipherment || false,
      dataEncipherment: keyUsage.dataEncipherment || false
    });
  }

  if (extKeyUsage) {
    extensions.push({
      name: 'extKeyUsage',
      serverAuth: extKeyUsage.serverAuth || false,
      clientAuth: extKeyUsage.clientAuth || false,
      codeSigning: extKeyUsage.codeSigning || false,
      emailProtection: extKeyUsage.emailProtection || false,
      timeStamping: extKeyUsage.timeStamping || false
    });
  }

  certificate.setExtensions(extensions);

  if (key) {

    // A private key was provided, use it to finalize the certificate.
    let privateKey = forge.pki.privateKeyFromPem(key);
    let publicKey = forge.pki.setRsaPublicKey(privateKey.n, privateKey.e);
    signOff({
      privateKey: privateKey,
      publicKey: publicKey
    });
    return;

  } else {

    // No private key was provided, generate a new one for this certificate.
    generateRSAKeyPair((error, keypair) => {
      if (error) {
        callback(error);
        return;
      }
      signOff(keypair);
      return;
    });

  }

  // Use a given TLS key pair to sign and return the certificate.
  function signOff (keypair) {

    certificate.publicKey = keypair.publicKey;

    if (caKey) {
      // Use the provided CA private key to sign the certificate.
      let signer = forge.pki.privateKeyFromPem(caKey);
      certificate.sign(signer, forge.md.sha256.create());
    } else {
      // Self-sign the certificate.
      certificate.sign(keypair.privateKey, forge.md.sha256.create());
    }

    let crt = forge.pki.certificateToPem(certificate);
    if (!key) {
      key = forge.pki.privateKeyToPem(keypair.privateKey);
    }

    callback(null, crt, key);
    return;

  }

}

exports.createTLSCertificate = createTLSCertificate;


// Generate an HTTPS certificate using Let's Encrypt (https://letsencrypt.org/).

function createHTTPSCertificate (parameters, callback) {

  let hostname = parameters.hostname;
  let accountEmail = parameters.accountEmail;
  let accountKey = parameters.accountKey || null;
  let httpsKey = parameters.httpsKey || null;
  let letsEncryptUrl = parameters.letsEncryptUrl || client.productionServerUrl;

  let acmeUrls = null;
  let registered = ('accountKey' in parameters);

  // Task: Use the given Let's Encrypt URL to discover its ACME protocol URLs.
  client.getAcmeUrls(letsEncryptUrl, (error, urls) => {
    if (error) {
      callback(error);
      return;
    }
    acmeUrls = urls;
    done();
  });

  if (!accountKey) {
    // Task: Generate a new account private key in PEM format.
    generateRSAKeyPair((error, keypair) => {
      if (error) {
        callback(error);
        return;
      }
      accountKey = forge.pki.privateKeyToPem(keypair.privateKey);
      done();
    });
  }

  if (!httpsKey) {
    // Task: Generate a new HTTPS private key in PEM format.
    generateRSAKeyPair((error, keypair) => {
      if (error) {
        callback(error);
        return;
      }
      httpsKey = forge.pki.privateKeyToPem(keypair.privateKey);
      done();
    });
  }

  // Wait for all required tasks to finish before proceding.
  function done () {

    if (!acmeUrls || !accountKey || !httpsKey) {
      // Some tasks are not finished yet. Let's wait.
      return;
    }

    if (!registered) {
      // One more task to wait for: Register to Let's Encrypt.
      registerLetsEncryptAccount({
        accountEmail: accountEmail,
        accountKey: accountKey,
        acmeUrls: acmeUrls
      }, (error, registration) => {
        if (error) {
          callback(error);
          return;
        }
        registered = true;
        done();
      });
      return;
    }

    // All required tasks are now finished, destroy the `done` callback.
    done = null;

    // We can now actually request an HTTPS certificate from Let's Encrypt.
    requestLetsEncryptCertificate({
      hostname: hostname,
      acmeUrls: acmeUrls,
      accountKey: accountKey,
      httpsKey: httpsKey
    }, (error, certificate) => {
      if (error) {
        callback(error);
        return;
      }
      callback(null, certificate, accountKey);
    });

  }

}

exports.createHTTPSCertificate = createHTTPSCertificate;


// Expose the URL prefix that Let's Encrypt will use to challenge our identity.

exports.letsEncryptChallengePrefix = letsEncryptChallengePrefix;


// Look for an identity token that satisfies the given Let's Encrypt challenge.

function getLetsEncryptChallengeToken (url) {

  if (!url || !url.startsWith(letsEncryptChallengePrefix)) {
    // Not a Let's Encrypt challenge URL.
    return null;
  }

  let key = url.slice(letsEncryptChallengePrefix.length);
  let token = letsEncryptChallenges[key] || null;

  if (!key || !token) {
    return null;
  }

  return token;

}

exports.getLetsEncryptChallengeToken = getLetsEncryptChallengeToken;


// Register a new Let's Encrypt account.

function registerLetsEncryptAccount (parameters, callback) {

  let accountEmail = parameters.accountEmail;
  let accountKey = parameters.accountKey;
  let acmeUrls = parameters.acmeUrls;

  let options = {
    newRegUrl: acmeUrls.newReg,
    email: accountEmail,
    accountKeypair: {
      privateKeyPem: accountKey
    },
    agreeToTerms: (url, agree) => {
      // Agree to anything. Now please send us all your money.
      agree(null, url);
    }
  };

  client.registerNewAccount(options, callback);

} // Don't export `registerLetsEncryptAccount`.


// Request HTTPS certificate issuance by Let's Encrypt via the ACME protocol.

function requestLetsEncryptCertificate (parameters, callback) {

  let hostname = parameters.hostname;
  let acmeUrls = parameters.acmeUrls;
  let accountKey = parameters.accountKey;
  let httpsKey = parameters.httpsKey;

  let options = {
    newAuthzUrl: acmeUrls.newAuthz,
    newCertUrl: acmeUrls.newCert,
    accountKeypair: {
      privateKeyPem: accountKey
    },
    domainKeypair: {
      privateKeyPem: httpsKey
    },
    setChallenge: (hostname, key, token, done) => {
      letsEncryptChallenges[key] = token;
      done();
    },
    removeChallenge: (hostname, key, done) => {
      delete letsEncryptChallenges[key];
      done();
    },
    domains: [
      hostname
    ]
  };

  client.getCertificate(options, callback);

} // Don't export `requestLetsEncryptCertificate`.
