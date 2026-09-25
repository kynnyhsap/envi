// @ts-expect-error The package does not exist. The loader test expects the install hint.
import missing from "envi-package-that-is-not-installed";

export default missing;
