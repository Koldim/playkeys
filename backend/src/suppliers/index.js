import { config } from "../config.js";
import { createSupplier } from "./createSupplier.js";

export const supplierA = createSupplier("A", config.supplierA);
export const supplierB = createSupplier("B", config.supplierB);
export const suppliers = [supplierA, supplierB];
