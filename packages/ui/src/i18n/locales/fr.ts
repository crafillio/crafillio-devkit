import type { PartialMessages } from '../index';

/** French. Untranslated keys fall back to English. */
export const messages: PartialMessages = {
  common: {
    save: 'Enregistrer', cancel: 'Annuler', delete: 'Supprimer', remove: 'Retirer',
    rename: 'Renommer', create: 'Créer', close: 'Fermer', add: 'Ajouter', edit: 'Modifier',
    refresh: 'Actualiser', clear: 'Effacer', import: 'Importer', export: 'Exporter',
    open: 'Ouvrir', run: 'Exécuter', stop: 'Arrêter', send: 'Envoyer', none: 'Aucun',
    name: 'Nom', value: 'Valeur', key: 'Clé', type: 'Type', status: 'Statut',
    duration: 'Durée', size: 'Taille', chooseFile: 'Choisir un fichier',
    noFileChosen: 'Aucun fichier choisi', copied: 'Copié',
  },
  titlebar: {
    importCurl: 'Importer curl', environments: 'Environnements',
    network: 'Paramètres proxy et TLS', about: 'À propos', theme: 'Thème',
    light: 'Clair', dark: 'Sombre', system: 'Système', language: 'Langue',
  },
  sidebar: {
    collections: 'Collections', workflows: 'Flux', history: 'Historique',
    s3: 'Connexions S3', filterRequests: 'Filtrer les requêtes',
    newCollection: 'Nouvelle collection', newWorkflow: 'Nouveau flux',
    addConnection: 'Ajouter une connexion', noCollections: 'Aucune collection.',
    noWorkflows: 'Aucun flux.', noHistory: 'Rien envoyé pour le moment.',
    noConnections: 'Aucune connexion S3.', duplicate: 'Dupliquer',
    copyAsCurl: 'Copier en curl', newFolder: 'Nouveau dossier',
  },
  request: {
    params: 'Paramètres', headers: 'En-têtes', body: 'Corps', auth: 'Authentification',
    settings: 'Réglages', loadTest: 'Test de charge', sending: 'Envoi en cours',
    noResponse: 'Aucune réponse', followRedirects: 'Suivre les redirections',
    ignoreTls: 'Ignorer les erreurs de certificat TLS',
  },
  workflow: {
    title: 'Flux', addStep: 'Ajouter une étape', runWorkflow: 'Exécuter le flux',
    exportReport: 'Exporter le rapport', exportPdf: 'Exporter en PDF',
    openReport: 'Ouvrir le rapport', inspect: 'Inspecter', inputs: 'Entrées',
    outputs: 'Sorties', availableHere: 'Disponible ici', completed: 'Flux terminé',
    failed: 'Échec du flux', removeStep: 'Retirer l’étape',
  },
  network: {
    title: 'Réseau', proxy: 'Proxy', tls: 'TLS / SSL',
    useProxy: 'Envoyer les requêtes via un proxy', proxyHost: 'Hôte du proxy', port: 'Port',
    username: 'Nom d’utilisateur', password: 'Mot de passe',
    verifyTls: 'Vérifier les certificats TLS', ignoreTls: 'Ignorer les erreurs de certificat TLS', clientCerts: 'Certificats client',
  },
  about: { title: 'À propos', creator: 'Créateur et mainteneur', viewProfile: 'Profil GitHub', repository: 'Dépôt',
    dataFolder: 'Dossier de données', secretStorage: 'Stockage des secrets', builtWith: 'Construit avec' },
  perf: { concurrency: 'Concurrence', requests: 'Requêtes', throughput: 'Débit',
    errorRate: 'Taux d’erreur', mean: 'Moyenne', runLoadTest: 'Lancer le test', errors: 'Erreurs' },
};
