const nodegit = require('nodegit')

async function checkOutCommit(repo, commitSHA) {
  let code

  console.log('Changing HEAD to ', commitSHA);
  code = repo.setHeadDetached(commitSHA, repo.defaultSignature(), "Checkout: HEAD " + commitSHA);
  if (code != 0) {
    throw Error("Could not checkout commit sha");
  }

  console.log('Checking out HEAD');
  return await nodegit.Checkout.head(repo, {
    checkoutStrategy: nodegit.Checkout.STRATEGY.FORCE
  });
}

async function cloneRepoBranch(gitAddress, gitBranch, gitToken, contentPath) {

  let cloneOptions = {}
  cloneOptions.checkoutBranch = gitBranch
  cloneOptions.fetchOpts = {
    callbacks: {
      certificateCheck: function() { return 1; },
      credentials: function() {
        return nodegit.Cred.userpassPlaintextNew(gitToken, "x-oauth-basic");
      }}};
  
  let cloneRepo = await nodegit.Clone(gitAddress, contentPath, cloneOptions)
  let repository = await nodegit.Repository.open(contentPath)

  return repository
}

module.exports = {
  cloneRepoBranch,
  checkOutCommit
}