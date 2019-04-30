// Copyright © 2018 Team Janitor. All rights reserved.
// The following code is covered by the AGPL-3.0 license.

const ComputeManagementClient = require('azure-arm-compute');
const msRestAzure = require('ms-rest-azure');

const db = require('./db');

load();

// Load our Azure Active Directory application configuration.
function load () {
  const azure = db.get('azure');
  if (!azure.credentials) {
    azure.credentials = {};
  }

  // You can customize these values in `./db.json` or via `/admin/`.
  const { credentials } = azure;

  // "Application ID" or "Client ID".
  if (!credentials.clientId) {
    credentials.clientId = '';
  }

  // "Application Secret" or "Authentication Key".
  if (!credentials.clientSecret) {
    credentials.clientSecret = '';
  }

  // "Domain" or "Directory ID" or "Tenant ID".
  if (!credentials.tenantId) {
    credentials.tenantId = '';
  }

  // "Azure Subscription ID".
  if (!credentials.subscriptionId) {
    credentials.subscriptionId = '';
  }
}

async function getComputeClient () {
  const { clientId, clientSecret, tenantId, subscriptionId } = db.get('azure').credentials;
  if (!clientId || !clientSecret || !tenantId || !subscriptionId) {
    throw new Error('Azure credentials not set up');
  }

  const { credentials } = await new Promise((resolve, reject) => {
    msRestAzure.loginWithServicePrincipalSecret(clientId, clientSecret, tenantId,
      (error, credentials, subscriptions) => {
        if (error) {
          reject(error);
          return;
        }

        resolve({ credentials, subscriptions });
      }
    );
  });

  return new ComputeManagementClient(credentials, subscriptionId);
}

// Get all Azure Virtual Machines.
exports.getAllVirtualMachines = async function () {
  const client = await getComputeClient();

  return new Promise((resolve, reject) => {
    client.virtualMachines.listAll((error, virtualMachines) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(virtualMachines);
    });
  });
};
