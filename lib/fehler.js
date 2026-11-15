// Fehler, die dem Benutzer als Meldung angezeigt werden (Status 400, 401, 404, 409, 429 ...).
// code ist ein maschinenlesbarer Schlüssel, den die Oberfläche in einen Text in der gewählten Sprache übersetzt;
// felder (optional) sagt je Eingabefeld, was nicht stimmt.
export class FehlerEingabe extends Error {
  constructor(message, status = 400, { code = null, felder = null } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.felder = felder;
  }
}
