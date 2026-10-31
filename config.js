// Shared by the web page (app.js) and the example-query check (scripts/check-queries.mjs),
// so both load the datasets the same way.

// Each data file is loaded into its own named graph <urn:dataset:FILE>
export const GRAPH_BASE = "urn:dataset:";

export const FORMATS = { ttl: "text/turtle", owl: "application/rdf+xml", rdf: "application/rdf+xml", nt: "application/n-triples" };

export const formatOf = (file) => FORMATS[file.split(".").pop()] ?? "text/turtle";
