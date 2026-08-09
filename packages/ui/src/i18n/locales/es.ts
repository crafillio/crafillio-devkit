import type { PartialMessages } from '../index';

/** Spanish. Untranslated keys fall back to English. */
export const messages: PartialMessages = {
  common: {
    save: 'Guardar', cancel: 'Cancelar', delete: 'Eliminar', remove: 'Quitar',
    rename: 'Renombrar', create: 'Crear', close: 'Cerrar', add: 'Añadir', edit: 'Editar',
    refresh: 'Actualizar', clear: 'Limpiar', import: 'Importar', export: 'Exportar',
    open: 'Abrir', run: 'Ejecutar', stop: 'Detener', send: 'Enviar', none: 'Ninguno',
    name: 'Nombre', value: 'Valor', key: 'Clave', type: 'Tipo', status: 'Estado',
    duration: 'Duración', size: 'Tamaño', chooseFile: 'Elegir archivo',
    noFileChosen: 'Ningún archivo elegido', copied: 'Copiado',
  },
  titlebar: {
    importCurl: 'Importar curl', environments: 'Entornos',
    network: 'Ajustes de proxy y TLS', about: 'Acerca de', theme: 'Tema',
    light: 'Claro', dark: 'Oscuro', system: 'Sistema', language: 'Idioma',
  },
  sidebar: {
    collections: 'Colecciones', workflows: 'Flujos', history: 'Historial',
    s3: 'Conexiones S3', filterRequests: 'Filtrar peticiones',
    newCollection: 'Nueva colección', newWorkflow: 'Nuevo flujo',
    addConnection: 'Añadir conexión', noCollections: 'Aún no hay colecciones.',
    noWorkflows: 'Aún no hay flujos.', noHistory: 'Nada enviado todavía.',
    noConnections: 'Sin conexiones S3.', duplicate: 'Duplicar',
    copyAsCurl: 'Copiar como curl', newFolder: 'Nueva carpeta',
  },
  request: {
    params: 'Parámetros', headers: 'Cabeceras', body: 'Cuerpo', auth: 'Autenticación',
    settings: 'Ajustes', loadTest: 'Prueba de carga', sending: 'Enviando',
    noResponse: 'Sin respuesta', followRedirects: 'Seguir redirecciones',
    ignoreTls: 'Ignorar errores de certificado TLS',
  },
  workflow: {
    title: 'Flujos', addStep: 'Añadir paso', runWorkflow: 'Ejecutar flujo',
    exportReport: 'Exportar informe', exportPdf: 'Exportar PDF',
    openReport: 'Abrir informe', inspect: 'Inspeccionar', inputs: 'Entradas',
    outputs: 'Salidas', availableHere: 'Disponible aquí', completed: 'Flujo completado',
    failed: 'El flujo falló', removeStep: 'Quitar paso',
  },
  network: {
    title: 'Red', proxy: 'Proxy', tls: 'TLS / SSL',
    useProxy: 'Enviar peticiones a través de un proxy', proxyHost: 'Host del proxy',
    port: 'Puerto', username: 'Usuario', password: 'Contraseña',
    verifyTls: 'Verificar certificados TLS', ignoreTls: 'Ignorar errores de certificado TLS', clientCerts: 'Certificados de cliente',
  },
  about: { title: 'Acerca de', creator: 'Creador y responsable', viewProfile: 'Perfil de GitHub', repository: 'Repositorio',
    dataFolder: 'Carpeta de datos', secretStorage: 'Almacén de secretos', builtWith: 'Construido con' },
  perf: { concurrency: 'Concurrencia', requests: 'Peticiones', throughput: 'Rendimiento',
    errorRate: 'Tasa de error', mean: 'Media', runLoadTest: 'Ejecutar prueba', errors: 'Errores' },
};
