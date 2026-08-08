import type { PartialMessages } from '../index';

/**
 * German. Anything not listed falls back to English by design, so a partial
 * translation is safe to ship and easy to extend.
 */
export const messages: PartialMessages = {
  common: {
    save: 'Speichern', cancel: 'Abbrechen', delete: 'Löschen', remove: 'Entfernen',
    rename: 'Umbenennen', create: 'Erstellen', close: 'Schließen', add: 'Hinzufügen',
    edit: 'Bearbeiten', refresh: 'Aktualisieren', clear: 'Leeren', import: 'Importieren',
    export: 'Exportieren', open: 'Öffnen', run: 'Ausführen', stop: 'Stoppen', send: 'Senden',
    none: 'Keine', name: 'Name', value: 'Wert', key: 'Schlüssel', type: 'Typ',
    status: 'Status', duration: 'Dauer', size: 'Größe',
    chooseFile: 'Datei wählen', noFileChosen: 'Keine Datei gewählt', copied: 'Kopiert',
  },
  titlebar: {
    importCurl: 'curl importieren', environments: 'Umgebungen',
    network: 'Proxy- und TLS-Einstellungen', about: 'Über', theme: 'Farbschema',
    light: 'Hell', dark: 'Dunkel', system: 'Systemeinstellung', language: 'Sprache',
  },
  sidebar: {
    collections: 'Sammlungen', workflows: 'Workflows', history: 'Verlauf',
    s3: 'S3-Verbindungen', filterRequests: 'Anfragen filtern',
    newCollection: 'Neue Sammlung', newWorkflow: 'Neuer Workflow',
    addConnection: 'Verbindung hinzufügen', noCollections: 'Noch keine Sammlungen.',
    noWorkflows: 'Noch keine Workflows.', noHistory: 'Noch nichts gesendet.',
    noConnections: 'Keine S3-Verbindungen.', duplicate: 'Duplizieren',
    copyAsCurl: 'Als curl kopieren', newFolder: 'Neuer Ordner',
  },
  request: {
    params: 'Parameter', headers: 'Header', body: 'Body', auth: 'Authentifizierung',
    settings: 'Einstellungen', loadTest: 'Lasttest', sending: 'Wird gesendet',
    noResponse: 'Noch keine Antwort', followRedirects: 'Weiterleitungen folgen',
    ignoreTls: 'TLS-Zertifikatsfehler ignorieren',
  },
  workflow: {
    title: 'Workflows', addStep: 'Schritt hinzufügen', runWorkflow: 'Workflow ausführen',
    exportReport: 'Bericht exportieren', exportPdf: 'PDF exportieren',
    openReport: 'Bericht öffnen', inspect: 'Prüfen', inputs: 'Eingaben', outputs: 'Ausgaben',
    availableHere: 'Hier verfügbar', completed: 'Workflow abgeschlossen',
    failed: 'Workflow fehlgeschlagen', removeStep: 'Schritt entfernen',
  },
  network: {
    title: 'Netzwerk', proxy: 'Proxy', tls: 'TLS / SSL',
    useProxy: 'Anfragen über einen Proxy senden', proxyHost: 'Proxy-Host', port: 'Port',
    username: 'Benutzername', password: 'Passwort',
    verifyTls: 'TLS-Zertifikate prüfen', clientCerts: 'Client-Zertifikate',
  },
  about: { title: 'Über', creator: 'Entwickler & Betreuer', viewProfile: 'GitHub-Profil', repository: 'Repository',
    dataFolder: 'Datenordner', secretStorage: 'Geheimnis-Speicher', builtWith: 'Erstellt mit' },
  perf: { concurrency: 'Parallelität', requests: 'Anfragen', throughput: 'Durchsatz',
    errorRate: 'Fehlerrate', mean: 'Mittelwert', runLoadTest: 'Lasttest starten', errors: 'Fehler' },
};
