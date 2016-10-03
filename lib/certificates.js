// Copyright © 2016 Jan Keromnes. All rights reserved.
// The following code is covered by the AGPL-3.0 license.

var child_process = require('child_process');
var forge = require('node-forge');


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
