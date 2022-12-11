import fs from "fs";
const packageJsonPath = "./pkg/package.json";
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
packageJson.type = "module";
fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson), "utf-8");
