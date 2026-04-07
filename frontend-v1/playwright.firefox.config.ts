import baseConfig from "./playwright.config";

export default {
  ...baseConfig,
  projects: [
    {
      name: "firefox",
      use: {
        ...(baseConfig.use ?? {}),
        browserName: "firefox",
      },
    },
  ],
};
