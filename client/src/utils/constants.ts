import type { FunnelStage, Country } from '../types'

// ─── Stage machine ────────────────────────────────────────────────────────────

export const BLOCKED_STAGES: FunnelStage[] = [
  'BLOQUEADO_NO_INTERESA',
  'BLOQUEADO_IMPOSIBLE_CONTACTO',
  'BLOQUEADO_FUERA_COBERTURA',
  'BLOQUEADO_NO_RESTAURANTE',
  'BLOQUEADO_RESTAURANTE_CERRADO',
  'BLOQUEADO_YA_EN_RAPPI',
]

export const STAGE_TRANSITIONS: Record<FunnelStage, FunnelStage[]> = {
  SIN_CONTACTO:                  ['CONTACTO_FALLIDO', 'CONTACTO_EFECTIVO', ...BLOCKED_STAGES],
  CONTACTO_FALLIDO:              ['CONTACTO_EFECTIVO', ...BLOCKED_STAGES],
  CONTACTO_EFECTIVO:             ['EN_GESTION', 'PROPUESTA_ENVIADA', 'ESPERANDO_DOCUMENTOS', 'OB', 'OK_R2S', ...BLOCKED_STAGES],
  EN_GESTION:                    ['PROPUESTA_ENVIADA', 'ESPERANDO_DOCUMENTOS', 'EN_FIRMA', 'OB', 'OK_R2S', ...BLOCKED_STAGES],
  PROPUESTA_ENVIADA:             ['ESPERANDO_DOCUMENTOS', 'EN_FIRMA', 'OB', 'OK_R2S', ...BLOCKED_STAGES],
  ESPERANDO_DOCUMENTOS:          ['EN_FIRMA', 'OB', 'OK_R2S', ...BLOCKED_STAGES],
  EN_FIRMA:                      ['OB', 'OK_R2S', ...BLOCKED_STAGES],
  OB:                            ['OK_R2S', ...BLOCKED_STAGES],
  OK_R2S:                        [],
  VENTA:                         [],
  BLOQUEADO_NO_INTERESA:         [],
  BLOQUEADO_IMPOSIBLE_CONTACTO:  [],
  BLOQUEADO_FUERA_COBERTURA:     [],
  BLOQUEADO_NO_RESTAURANTE:      [],
  BLOQUEADO_RESTAURANTE_CERRADO: [],
  BLOQUEADO_YA_EN_RAPPI:         [],
}

// ─── Stage labels ─────────────────────────────────────────────────────────────

export const STAGE_LABEL: Record<FunnelStage, string> = {
  SIN_CONTACTO:                  'Sin Contacto',
  CONTACTO_FALLIDO:              'C. Fallido',
  CONTACTO_EFECTIVO:             'C. Efectivo',
  EN_GESTION:                    'En Gestión',
  PROPUESTA_ENVIADA:             'Prop. Enviada',
  ESPERANDO_DOCUMENTOS:          'Esp. Docs',
  EN_FIRMA:                      'En Firma',
  OB:                            'OB',
  OK_R2S:                        'OK R2S',
  VENTA:                         'Venta',
  BLOQUEADO_NO_INTERESA:         'No Interesa',
  BLOQUEADO_IMPOSIBLE_CONTACTO:  'Imp. Contacto',
  BLOQUEADO_FUERA_COBERTURA:     'Fuera Cob.',
  BLOQUEADO_NO_RESTAURANTE:      'No Rest.',
  BLOQUEADO_RESTAURANTE_CERRADO: 'Rest. Cerrado',
  BLOQUEADO_YA_EN_RAPPI:         'Ya en Rappi',
}

// ─── Stage colors ─────────────────────────────────────────────────────────────

export const STAGE_COLORS: Record<FunnelStage, { bg: string; text: string; border: string; header: string }> = {
  SIN_CONTACTO:                  { bg: 'bg-gray-50',   text: 'text-gray-600',   border: 'border-gray-200',   header: 'bg-gray-100'   },
  CONTACTO_FALLIDO:              { bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200', header: 'bg-orange-100' },
  CONTACTO_EFECTIVO:             { bg: 'bg-blue-50',   text: 'text-blue-700',   border: 'border-blue-200',   header: 'bg-blue-100'   },
  EN_GESTION:                    { bg: 'bg-cyan-50',   text: 'text-cyan-700',   border: 'border-cyan-200',   header: 'bg-cyan-100'   },
  PROPUESTA_ENVIADA:             { bg: 'bg-teal-50',   text: 'text-teal-700',   border: 'border-teal-200',   header: 'bg-teal-100'   },
  ESPERANDO_DOCUMENTOS:          { bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-200', header: 'bg-purple-100' },
  EN_FIRMA:                      { bg: 'bg-amber-50',  text: 'text-amber-700',  border: 'border-amber-200',  header: 'bg-amber-100'  },
  OB:                            { bg: 'bg-indigo-50', text: 'text-indigo-700', border: 'border-indigo-200', header: 'bg-indigo-100' },
  OK_R2S:                        { bg: 'bg-green-50',  text: 'text-green-700',  border: 'border-green-200',  header: 'bg-green-100'  },
  VENTA:                         { bg: 'bg-green-50',  text: 'text-green-700',  border: 'border-green-200',  header: 'bg-green-100'  },
  BLOQUEADO_NO_INTERESA:         { bg: 'bg-red-50',    text: 'text-red-700',    border: 'border-red-200',    header: 'bg-red-100'    },
  BLOQUEADO_IMPOSIBLE_CONTACTO:  { bg: 'bg-red-50',    text: 'text-red-700',    border: 'border-red-200',    header: 'bg-red-100'    },
  BLOQUEADO_FUERA_COBERTURA:     { bg: 'bg-red-50',    text: 'text-red-700',    border: 'border-red-200',    header: 'bg-red-100'    },
  BLOQUEADO_NO_RESTAURANTE:      { bg: 'bg-red-50',    text: 'text-red-700',    border: 'border-red-200',    header: 'bg-red-100'    },
  BLOQUEADO_RESTAURANTE_CERRADO: { bg: 'bg-red-50',    text: 'text-red-700',    border: 'border-red-200',    header: 'bg-red-100'    },
  BLOQUEADO_YA_EN_RAPPI:         { bg: 'bg-red-50',    text: 'text-red-700',    border: 'border-red-200',    header: 'bg-red-100'    },
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
  'OK-R2S':                      'OK_R2S',
  'OK R2S':                      'OK_R2S',
  'OK/ Diferente RS':            'OK_R2S',
  'VENTA':                       'VENTA',
  'Venta':                       'VENTA',
  'Esperando Documentos':        'ESPERANDO_DOCUMENTOS',
  'ESPERANDO DOCUMENTOS':        'ESPERANDO_DOCUMENTOS',
  'Documentos Completos':        'ESPERANDO_DOCUMENTOS',
  'En Gestión':                  'EN_GESTION',
  'EN GESTION':                  'EN_GESTION',
  'En Firma':                    'EN_FIRMA',
  'EN FIRMA':                    'EN_FIRMA',
  'OB':                          'OB',
  'Propuesta Enviada':           'PROPUESTA_ENVIADA',
  'PROPUESTA ENVIADA':           'PROPUESTA_ENVIADA',
  'Contacto Efectivo':           'CONTACTO_EFECTIVO',
  'CONTACTO EFECTIVO':           'CONTACTO_EFECTIVO',
  'Contacto Fallido':            'CONTACTO_FALLIDO',
  'CONTACTO FALLIDO':            'CONTACTO_FALLIDO',
  'Sin Contacto':                'SIN_CONTACTO',
  'SIN CONTACTO':                'SIN_CONTACTO',
  'Bloqueado: No le interesa':   'BLOQUEADO_NO_INTERESA',
  'BLOQUEADO NO INTERESA':       'BLOQUEADO_NO_INTERESA',
  'Bloqueado: Imposible Contacto': 'BLOQUEADO_IMPOSIBLE_CONTACTO',
  'BLOQUEADO IMPOSIBLE CONTACTO':  'BLOQUEADO_IMPOSIBLE_CONTACTO',
  'Bloqueado: Fuera de cobertura': 'BLOQUEADO_FUERA_COBERTURA',
  'BLOQUEADO FUERA COBERTURA':     'BLOQUEADO_FUERA_COBERTURA',
  'Bloqueado: No es restaurante':  'BLOQUEADO_NO_RESTAURANTE',
  'BLOQUEADO NO RESTAURANTE':      'BLOQUEADO_NO_RESTAURANTE',
  'Bloqueado: Restaurante Cerrado': 'BLOQUEADO_RESTAURANTE_CERRADO',
  'BLOQUEADO RESTAURANTE CERRADO':  'BLOQUEADO_RESTAURANTE_CERRADO',
  'Bloqueado: Ya está en Rappi':   'BLOQUEADO_YA_EN_RAPPI',
  'BLOQUEADO YA EN RAPPI':         'BLOQUEADO_YA_EN_RAPPI',
}
