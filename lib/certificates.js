// Copyright © 2016 Team Janitor. All rights reserved.
// The following code is covered by the AGPL-3.0 license.

const child_process = require('child_process');
const forge = require('node-forge');
const letsencrypt = require('le-acme-core');

// ACME protocol client to interact with the Let's Encrypt service.
const client = letsencrypt.ACME.create({
  rsaKeySize: 4096
});

// The URL prefix that Let's Encrypt will use to challenge our identity.
// Source: https://ietf-wg-acme.github.io/acme/#http
const letsEncryptChallengePrefix =
  letsencrypt.acmeChallengePrefix || '/.well-known/acme-challenge/';

// ACME protocol challenge tokens proving our identity to Let's Encrypt.
const letsEncryptChallenges = {};

// Verify if a given certificate in PEM format satisfies validity constraints.
exports.isValid = function (parameters, enableDebug) {
  const debug = () => {
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
  const padding = 24 * 3600 * 1000;
  const now = new Date();
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
      const caStore = forge.pki.createCaStore(parameters.ca);
      if (!forge.pki.verifyCertificateChain(caStore, [certificate])) {
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
      const privateKey = forge.pki.privateKeyFromPem(parameters.key);
      const md = forge.md.sha256.create();
      md.update('verify me', 'utf8');
      const signature = privateKey.sign(md);
      if (!certificate.publicKey.verify(md.digest().bytes(), signature)) {
        debug('Certificate doesn\'t match the provided RSA private key.');
        return false;
      }
    } catch (error) {
      debug('Problem during RSA private key verification:', error);
      return false;
    }
  }

  if ('hostnames' in parameters) {
    const hostnames = parameters.hostnames;
    const commonName = certificate.subject.getField('CN').value;
    let altNames = [commonName];
    const subjectAltName = certificate.getExtension('subjectAltName');
    if (subjectAltName) {
      altNames = subjectAltName.altNames
        .filter(altName => altName.type === 2) // DNS
        .map(altName => altName.value);
    }
    for (const hostname of hostnames) {
      if (!altNames.includes(hostname)) {
        debug('Certificate is not valid for hostname "' + hostname + '" ' +
          '(should be one of: "' + altNames.join('", "') + '").');
        return false;
      }
    }
  }

  return true;
};

// Generate an RSA public and private key pair in forge format (binary).
exports.generateRSAKeyPair = function () {
  // Generate a new 4096-bit RSA private key (up to 100x faster than forge).
  return new Promise((resolve, reject) => {
    child_process.exec('openssl genrsa 4096', (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }

      // Convert OpenSSL's PEM output format to binary forge representation.
      const privateKey = forge.pki.privateKeyFromPem(stdout);

      // Extract the public key from the private key.
      const publicKey = forge.pki.setRsaPublicKey(privateKey.n, privateKey.e);

      resolve({ privateKey, publicKey });
    });
  });
};

// Generate an SSH public and private key pair in OpenSSH format.
exports.createSSHKeyPair = async function () {
  const keypair = await exports.generateRSAKeyPair();
  const fingerprint = forge.ssh.getPublicKeyFingerprint(keypair.publicKey, {
    encoding: 'hex',
    delimiter: ':'
  });
  const privateKey = forge.ssh.privateKeyToOpenSSH(keypair.privateKey);
  const publicKey = forge.ssh.publicKeyToOpenSSH(keypair.publicKey);

  return { fingerprint, privateKey, publicKey };
};

// Create a TLS certificate in PEM format.
exports.createTLSCertificate = async function (parameters) {
  const commonName = parameters.commonName;
  const altNames = parameters.altNames || [];
  const basicConstraints = parameters.basicConstraints || null;
  const keyUsage = parameters.keyUsage || null;
  const extKeyUsage = parameters.extKeyUsage || null;
  let key = parameters.key || null;
  const caCrt = parameters.caCrt || null;
  const caKey = parameters.caKey || null;

  const certificate = forge.pki.createCertificate();

  // Make the certificate valid for one year, starting now.
  const notBefore = new Date();
  const notAfter = new Date();
  notAfter.setFullYear(notBefore.getFullYear() + 1);

  certificate.validity.notBefore = notBefore;
  certificate.validity.notAfter = notAfter;

  const attributes = [{
    name: 'commonName',
    value: commonName
  }];

  certificate.setSubject(attributes);

  if (caCrt) {
    // Use the provided CA certificate to issue the certificate.
    const issuer = forge.pki.certificateFromPem(caCrt);
    certificate.setIssuer(issuer.subject.attributes);
  } else {
    // Issue a self-signed certificate.
    certificate.setIssuer(attributes);
  }

  if (altNames.indexOf(commonName) < 0) {
    altNames.unshift(commonName);
  }

  const extensions = [{
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

  let keypair = null;
  if (key) {
    // A private key was provided, use it to finalize the certificate.
    const privateKey = forge.pki.privateKeyFromPem(key);
    const publicKey = forge.pki.setRsaPublicKey(privateKey.n, privateKey.e);
    keypair = { privateKey, publicKey };
  } else {
    // No private key was provided, generate a new one for this certificate.
    keypair = await exports.generateRSAKeyPair();
    key = forge.pki.privateKeyToPem(keypair.privateKey);
  }

  certificate.publicKey = keypair.publicKey;

  if (caKey) {
    // Use the provided CA private key to sign the certificate.
    const signer = forge.pki.privateKeyFromPem(caKey);
    certificate.sign(signer, forge.md.sha256.create());
  } else {
    // Self-sign the certificate.
    certificate.sign(keypair.privateKey, forge.md.sha256.create());
  }

  const crt = forge.pki.certificateToPem(certificate);
  return { crt, key };
};

// Generate an HTTPS certificate using Let's Encrypt (https://letsencrypt.org/).
exports.createHTTPSCertificate = async function (parameters) {
  const hostnames = parameters.hostnames;
  const accountEmail = parameters.accountEmail;
  let accountKey = parameters.accountKey || null;
  let httpsKey = parameters.httpsKey || null;
  const letsEncryptUrl = parameters.letsEncryptUrl || client.productionServerUrl;

  let acmeUrls = null;
  const registered = ('accountKey' in parameters);

  // Collect all tasks that can be run in parallel for faster results.
  const tasks = [];

  // Task: Use the given Let's Encrypt URL to discover its ACME protocol URLs.
  tasks.push(new Promise((resolve, reject) => {
    client.getAcmeUrls(letsEncryptUrl, (error, urls) => {
      if (error) {
        reject(error);
        return;
      }
      acmeUrls = urls;
      resolve();
    });
  }));

  if (!accountKey) {
    // Task: Generate a new account private key in PEM format.
    tasks.push(exports.generateRSAKeyPair().then(keypair => {
      accountKey = forge.pki.privateKeyToPem(keypair.privateKey);
    }));
  }

  if (!httpsKey) {
    // Task: Generate a new HTTPS private key in PEM format.
    tasks.push(exports.generateRSAKeyPair().then(keypair => {
      httpsKey = forge.pki.privateKeyToPem(keypair.privateKey);
    }));
  }

  // Run all required tasks in parallel, and wait for them to finish.
  await Promise.all(tasks);

  if (!registered) {
    // One more task to wait for: Register to Let's Encrypt.
    await registerLetsEncryptAccount({
      accountEmail,
      accountKey,
      acmeUrls,
    });
  }

  // We can now actually request an HTTPS certificate from Let's Encrypt.
  const certificate = await requestLetsEncryptCertificate({
    hostnames,
    acmeUrls,
    accountKey,
    httpsKey,
  });

  return { certificate, accountKey };
};

// Expose the URL prefix that Let's Encrypt will use to challenge our identity.
exports.letsEncryptChallengePrefix = letsEncryptChallengePrefix;

// Look for an identity token that satisfies the given Let's Encrypt challenge.
exports.getLetsEncryptChallengeToken = function (url) {
  if (!url || !url.startsWith(letsEncryptChallengePrefix)) {
    // Not a Let's Encrypt challenge URL.
    return null;
  }

  const key = url.slice(letsEncryptChallengePrefix.length);
  const token = letsEncryptChallenges[key] || null;

  if (!key || !token) {
    return null;
  }

  return token;
};

// Register a new Let's Encrypt account.
function registerLetsEncryptAccount (parameters) {
  const accountEmail = parameters.accountEmail;
  const accountKey = parameters.accountKey;
  const acmeUrls = parameters.acmeUrls;

  const options = {
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

  return new Promise((resolve, reject) => {
    client.registerNewAccount(options, (error, registration) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(registration);
    });
  });
}

// Request HTTPS certificate issuance by Let's Encrypt via the ACME protocol.
function requestLetsEncryptCertificate (parameters) {
  const hostnames = parameters.hostnames;
  const acmeUrls = parameters.acmeUrls;
  const accountKey = parameters.accountKey;
  const httpsKey = parameters.httpsKey;

  const options = {
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
    domains: hostnames
  };

  return new Promise((resolve, reject) => {
    client.getCertificate(options, (error, certificate) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(certificate);
    });
  });
}
