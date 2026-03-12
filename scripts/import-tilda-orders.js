const path = require("node:path");

const {
  loadOrder,
  mergeOrders,
  normalizeTildaCsvRow,
  parseTildaCsvFile,
  saveOrder
} = require("../lib/orders");

function resolveCsvPath(inputPath) {
  if (inputPath) {
    return path.resolve(process.cwd(), inputPath);
  }

  return path.resolve(
    __dirname,
    "..",
    "orders",
    "leads-95f85ca9e657c61cf1133d7f7d4409f3e366b2ba9f88e7217215736531139774.csv"
  );
}

function main() {
  const csvPath = resolveCsvPath(process.argv[2]);
  const rows = parseTildaCsvFile(csvPath);

  let created = 0;
  let updated = 0;

  for (const row of rows) {
    const normalizedOrder = normalizeTildaCsvRow(row);
    const existingOrder = loadOrder(normalizedOrder.id);
    const mergedOrder = mergeOrders(existingOrder, normalizedOrder);
    saveOrder(mergedOrder);

    if (existingOrder) {
      updated += 1;
    } else {
      created += 1;
    }
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        csvPath,
        rows: rows.length,
        created,
        updated
      },
      null,
      2
    )
  );
}

main();
