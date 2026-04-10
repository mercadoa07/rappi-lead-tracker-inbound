import type { FunnelStage, Country } from '../types'

// ─── Stage machine ────────────────────────────────────────────────────────────

export const STAGE_TRANSITIONS: Record<FunnelStage, FunnelStage[]> = {
  SIN_CONTACTO:         ['CONTACTO_FALLIDO', 'CONTACTO_EFECTIVO', 'DESCARTADO'],
  CONTACTO_FALLIDO:     ['CONTACTO_EFECTIVO', 'DESCARTADO'],
  CONTACTO_EFECTIVO:    ['EN_GESTION', 'PROPUESTA_ENVIADA', 'ESPERANDO_DOCUMENTOS', 'OB', 'OK_R2S', 'DESCARTADO'],
  EN_GESTION:           ['PROPUESTA_ENVIADA', 'ESPERANDO_DOCUMENTOS', 'EN_FIRMA', 'OB', 'OK_R2S', 'DESCARTADO'],
  PROPUESTA_ENVIADA:    ['ESPERANDO_DOCUMENTOS', 'EN_FIRMA', 'OB', 'OK_R2S', 'DESCARTADO'],
  ESPERANDO_DOCUMENTOS: ['EN_FIRMA', 'OB', 'OK_R2S', 'DESCARTADO'],
  EN_FIRMA:             ['OB', 'OK_R2S', 'DESCARTADO'],
  OB:                   ['OK_R2S', 'DESCARTADO'],
  OK_R2S:               [],
  VENTA:                [],
  DESCARTADO:           [],
}

// ─── Stage labels ─────────────────────────────────────────────────────────────

export const STAGE_LABEL: Record<FunnelStage, string> = {
  SIN_CONTACTO:         'Sin Contacto',
  CONTACTO_FALLIDO:     'C. Fallido',
  CONTACTO_EFECTIVO:    'C. Efectivo',
  EN_GESTION:           'En Gestión',
  PROPUESTA_ENVIADA:    'Prop. Enviada',
  ESPERANDO_DOCUMENTOS: 'Esp. Docs',
  EN_FIRMA:             'En Firma',
  OB:                   'OB',
  OK_R2S:               'OK R2S',
  VENTA:                'Venta',
  DESCARTADO:           'Descartado',
}

// ─── Stage colors ─────────────────────────────────────────────────────────────

export const STAGE_COLORS: Record<FunnelStage, { bg: string; text: string; border: string; header: string }> = {
  SIN_CONTACTO:         { bg: 'bg-gray-50',   text: 'text-gray-600',   border: 'border-gray-200',   header: 'bg-gray-100'   },
  CONTACTO_FALLIDO:     { bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200', header: 'bg-orange-100' },
  CONTACTO_EFECTIVO:    { bg: 'bg-blue-50',   text: 'text-blue-700',   border: 'border-blue-200',   header: 'bg-blue-100'   },
  EN_GESTION:           { bg: 'bg-cyan-50',   text: 'text-cyan-700',   border: 'border-cyan-200',   header: 'bg-cyan-100'   },
  PROPUESTA_ENVIADA:    { bg: 'bg-teal-50',   text: 'text-teal-700',   border: 'border-teal-200',   header: 'bg-teal-100'   },
  ESPERANDO_DOCUMENTOS: { bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-200', header: 'bg-purple-100' },
  EN_FIRMA:             { bg: 'bg-amber-50',  text: 'text-amber-700',  border: 'border-amber-200',  header: 'bg-amber-100'  },
  OB:                   { bg: 'bg-indigo-50', text: 'text-indigo-700', border: 'border-indigo-200', header: 'bg-indigo-100' },
  OK_R2S:               { bg: 'bg-green-50',  text: 'text-green-700',  border: 'border-green-200',  header: 'bg-green-100'  },
  VENTA:                { bg: 'bg-green-50',  text: 'text-green-700',  border: 'border-green-200',  header: 'bg-green-100'  },
  DESCARTADO:           { bg: 'bg-red-50',    text: 'text-red-700',    border: 'border-red-200',    header: 'bg-red-100'    },
}

// ─── Country flags ────────────────────────────────────────────────────────────

export const COUNTRY_FLAG: Record<Country, string> = {
  CO: '🇨🇴',
  MX: '🇲🇽',
  AR: '🇦🇷',
  PE: '🇵🇪',
  CL: '🇨🇱',
  EC: '🇪🇨',
}

export const COUNTRIES: Country[] = ['CO', 'MX', 'AR', 'PE', 'CL', 'EC']

// ─── ESTADO → funnel_stage mapping (para import) ──────────────────────────────

export const ESTADO_MAP: Record<string, FunnelStage> = {
  'OK-R2S':                                      'OK_R2S',
  'OK R2S':                                      'OK_R2S',
  'OK/ Diferente RS':                            'OK_R2S',
  'se logra contacto envia documentacion / R2S': 'OK_R2S',
  'VENTA':                                       'OK_R2S',
  'Venta':                                       'OK_R2S',
  'YA ACTIVA':                                   'OK_R2S',
  'Ya Activa':                                   'OK_R2S',
  'Esperando Documentos':                        'ESPERANDO_DOCUMENTOS',
  'ESPERANDO DOCUMENTOS':                        'ESPERANDO_DOCUMENTOS',
  'Documentos Completos':                        'EN_FIRMA',
  'Documentos completos':                        'EN_FIRMA',
  'DOC CHEKER':                                  'EN_FIRMA',
  'En Gestión':                                  'EN_GESTION',
  'EN GESTION':                                  'EN_GESTION',
  'En Firma':                                    'EN_FIRMA',
  'EN FIRMA':                                    'EN_FIRMA',
  'OB':                                          'OB',
  'Propuesta Enviada':                           'PROPUESTA_ENVIADA',
  'PROPUESTA ENVIADA':                           'PROPUESTA_ENVIADA',
  'Contacto Efectivo':                           'CONTACTO_EFECTIVO',
  'CONTACTO EFECTIVO':                           'CONTACTO_EFECTIVO',
  'Contacto Fallido':                            'CONTACTO_FALLIDO',
  'CONTACTO FALLIDO':                            'CONTACTO_FALLIDO',
  'Fallido':                                     'CONTACTO_FALLIDO',
  'Sin Contacto':                                'SIN_CONTACTO',
  'SIN CONTACTO':                                'SIN_CONTACTO',
  'Bloqueado: No le interesa':                   'DESCARTADO',
  'BLOQUEADO NO INTERESA':                       'DESCARTADO',
  'Bloqueado: Imposible contacto':               'DESCARTADO',
  'Bloqueado: Imposible Contacto':               'DESCARTADO',
  'BLOQUEADO IMPOSIBLE CONTACTO':                'DESCARTADO',
  'Bloqueado: Fuera de cobertura':               'DESCARTADO',
  'BLOQUEADO FUERA COBERTURA':                   'DESCARTADO',
  'Bloqueado: No es restaurante':                'DESCARTADO',
  'BLOQUEADO NO RESTAURANTE':                    'DESCARTADO',
  'Bloqueado: Restaurante cerrado':              'DESCARTADO',
  'Bloqueado: Restaurante Cerrado':              'DESCARTADO',
  'BLOQUEADO RESTAURANTE CERRADO':               'DESCARTADO',
  'Bloqueado: Ya trabaja con Rappi':             'DESCARTADO',
  'Bloqueado: Ya está en Rappi':                 'DESCARTADO',
  'BLOQUEADO YA EN RAPPI':                       'DESCARTADO',
  'Bloqueado: Lead duplicado':                   'DESCARTADO',
}
