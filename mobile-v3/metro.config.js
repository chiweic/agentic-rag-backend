const { getDefaultConfig } = require("expo/metro-config");
const path = require("node:path");

const projectRoot = __dirname;
const config = getDefaultConfig(projectRoot);

// Watch only project files (monorepoRoot causes EACCES on some dirs)
config.watchFolders = [projectRoot];

// Enable symlinks support for pnpm
config.resolver.unstable_enableSymlinks = true;

// Let Metro know where to resolve packages
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(projectRoot, "..", "node_modules"),
];

// Force resolving shared dependencies from the app's node_modules
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (
    moduleName === "react" ||
    moduleName === "react-native" ||
    moduleName.startsWith("react/") ||
    moduleName.startsWith("react-native/")
  ) {
    return context.resolveRequest(
      {
        ...context,
        originModulePath: path.resolve(projectRoot, "package.json"),
      },
      moduleName,
      platform,
    );
  }

  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
