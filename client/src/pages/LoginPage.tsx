import { useState } from 'react'
import { toast } from 'sonner'
import { useAuth } from '../context/AuthContext'

export default function LoginPage() {
  const { loginWithGoogle, unauthorized } = useAuth()
  const [isLoading, setIsLoading]         = useState(false)

  const handleGoogle = async () => {
    setIsLoading(true)
    try {
      await loginWithGoogle()
    } catch {
      toast.error('Error al iniciar sesión con Google. Intenta de nuevo.')
      setIsLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen">
      {/* Panel izquierdo: Branding */}
      <div className="hidden lg:flex lg:w-1/2 flex-col items-center justify-center bg-[#FF441F] relative overflow-hidden">
        <div className="absolute -top-20 -left-20 h-80 w-80 rounded-full bg-white/10" />
        <div className="absolute -bottom-32 -right-32 h-96 w-96 rounded-full bg-black/10" />

        <div className="relative z-10 flex flex-col items-center gap-6 px-12 text-center">
          <h1 className="text-7xl font-extrabold text-white tracking-tight">Rappi</h1>
          <div className="h-1 w-16 rounded-full bg-white/60" />
          <h2 className="text-2xl font-bold text-white">Lead Tracker</h2>
          <div className="px-4 py-1.5 rounded-full bg-white/20 border border-white/30">
            <span className="text-sm font-bold text-white tracking-widest uppercase">INBOUND</span>
          </div>
          <p className="max-w-sm text-base text-white/80 leading-relaxed">
            Gestiona, monitorea y convierte tus leads Inbound de manera
            eficiente con la plataforma interna de Rappi.
          </p>
        </div>
      </div>

      {/* Panel derecho: Login */}
      <div className="flex w-full lg:w-1/2 items-center justify-center bg-[#F5F5F5] px-6 py-12">
        <div className="w-full max-w-md">
          <div className="mb-10 lg:hidden text-center">
            <h1 className="text-4xl font-extrabold text-[#FF441F]">Rappi</h1>
            <p className="text-sm text-gray-500 mt-1">Lead Tracker — Inbound</p>
          </div>

          <div className="mb-8">
            <h2 className="text-2xl font-bold text-black">Iniciar sesión</h2>
            <p className="mt-1 text-sm text-gray-500">
              Usa tu cuenta corporativa de Rappi para acceder
            </p>
          </div>

          {unauthorized && (
            <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              Tu cuenta no tiene acceso a esta herramienta. Contacta a tu líder para que te registre.
            </div>
          )}

          <button
            onClick={handleGoogle}
            disabled={isLoading}
            className="flex w-full items-center justify-center gap-3 rounded-xl border border-gray-200 bg-white px-6 py-3.5 text-sm font-semibold text-gray-700 shadow-sm transition-all hover:shadow-md hover:border-gray-300 active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {/* Google icon */}
            <svg width="20" height="20" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            {isLoading ? 'Redirigiendo...' : 'Continuar con Google'}
          </button>

          <p className="mt-8 text-center text-xs text-gray-400">
            Solo cuentas <span className="font-semibold">@rappi.com</span> tienen acceso
          </p>

          <p className="mt-2 text-center text-xs text-gray-400">
            Rappi Lead Tracker — Herramienta de gestión Inbound
          </p>
        </div>
      </div>
    </div>
  )
}
