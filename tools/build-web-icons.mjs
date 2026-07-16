import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const root = process.cwd();
const roles = ["student", "admin"];

await fs.mkdir(path.join(root, "assets", "icons"), { recursive: true });
await fs.mkdir(path.join(root, "student"), { recursive: true });
await fs.mkdir(path.join(root, "admin"), { recursive: true });

for (const role of roles) {
  const source = path.join(root, "assets", "icons", `${role}-icon-source.svg`);
  const outputs = [
    [path.join(root, "assets", "icons", `${role}-icon-512.png`), 512],
    [path.join(root, "assets", "icons", `${role}-icon-192.png`), 192],
    [path.join(root, "assets", "icons", `${role}-favicon-64.png`), 64],
    [path.join(root, role, "apple-touch-icon.png"), 180]
  ];

  for (const [target, size] of outputs) {
    await sharp(source, { density: 384 })
      .resize(size, size, { fit: "cover" })
      .png({ compressionLevel: 9, adaptiveFiltering: true })
      .toFile(target);
  }
}

console.log("Student and administrator web icons generated.");
