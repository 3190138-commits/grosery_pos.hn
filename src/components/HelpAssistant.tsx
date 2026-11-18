import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  HelpCircle,
  X,
  Send,
  ArrowRight,
  Compass,
  MessageSquareHeart,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  RotateCcw,
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import type { UserRole } from '../types';

export interface HelpAssistantProps {
  mode: 'store' | 'admin';
  currentScreen: string;
  userRole?: UserRole | string;
  userName?: string;
  cartCount?: number;
  allowedAdminTabs?: string[];
  onNavigate: (target: string) => void;
}

interface AssistantAction {
  type: 'navigate';
  target: string;
  label: string;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  steps?: string[];
  suggested_questions?: string[];
  action?: AssistantAction;
  isError?: boolean;
}

interface TourStep {
  title: string;
  summary: string;
  bullets: string[];
  target: string;
  ctaLabel: string;
}

const STORE_TOUR: TourStep[] = [
  {
    title: '1. Busca y explora productos',
    summary: 'Encuentra abarrotes, bebidas, lácteos, snacks o limpieza en segundos.',
    bullets: [
      'Usa la barra de búsqueda superior para escribir el nombre de lo que necesitas.',
      'También puedes tocar una categoría o entrar a "Catálogo" y "Ofertas".',
      'Toca cualquier producto si quieres ver su presentación, marca y existencias.',
    ],
    target: 'catalogo',
    ctaLabel: 'Ir al Catálogo',
  },
  {
    title: '2. Agrega productos a tu carrito',
    summary: 'Arma tu compra con las cantidades exactas que quieras llevar.',
    bullets: [
      'Pulsa el botón verde "+ Agregar" en cada producto que desees.',
      'Abre el carrito arriba a la derecha para sumar, restar o quitar artículos.',
      'Recuerda: para envío a domicilio el pedido mínimo es de L. 70.00 (recoger en tienda no tiene mínimo).',
    ],
    target: 'carrito',
    ctaLabel: 'Abrir mi Carrito',
  },
  {
    title: '3. Elige entrega, mapa y forma de pago',
    summary: 'Finaliza tu pedido en menos de un minuto.',
    bullets: [
      'Dentro del carrito pulsa "Finalizar pedido".',
      'Escoge "Envío a domicilio" o "Recoger en tienda" y llena tu nombre y teléfono.',
      'Si eliges domicilio, pulsa "Ubicar en mapa" y ajusta el pin en tu casa exacta.',
      'Paga en Efectivo al recibir o por Transferencia subiendo tu comprobante.',
    ],
    target: 'carrito',
    ctaLabel: 'Ver Carrito / Pagar',
  },
  {
    title: '4. Sigue tu pedido en el mapa en vivo',
    summary: 'Mira por dónde viene tu repartidor y recibe alertas.',
    bullets: [
      'Entra a la pestaña "Seguimiento" en el menú superior.',
      'Escribe tu número de pedido (por ejemplo: PED-2026-0144) y pulsa "Buscar".',
      'Verás la ruta desde la tienda, el repartidor en vivo cuando salga y el botón "Confirmar pedido recibido".',
    ],
    target: 'seguimiento',
    ctaLabel: 'Abrir Seguimiento',
  },
  {
    title: '5. Revisa tus facturas y repite compras',
    summary: 'Guarda tus direcciones y repite pedidos anteriores con un clic.',
    bullets: [
      'Entra a "Mi cuenta" e inicia sesión (o regístrate gratis).',
      'Consulta todos tus pedidos, descarga tu comprobante en PDF y usa "Repetir pedido".',
    ],
    target: 'cuenta',
    ctaLabel: 'Ir a Mi Cuenta',
  },
];

const ADMIN_TOUR: TourStep[] = [
  {
    title: '1. Recibir y despachar pedidos en línea',
    summary: 'Atiende los pedidos que llegan desde la tienda web.',
    bullets: [
      'Entra a "Pedidos en línea" para ver pedidos nuevos ("Recibido").',
      'Verifica el método de pago y comprobante si pagaron por transferencia.',
      'Acepta el pedido, pásalo a "En preparación", asigna un repartidor y márcalo "En camino".',
    ],
    target: 'orders',
    ctaLabel: 'Ir a Pedidos en línea',
  },
  {
    title: '2. Cobrar en Punto de Venta (POS) y Escáner',
    summary: 'Registra ventas presenciales rápidas con código de barras o búsqueda.',
    bullets: [
      'Escanea directamente con lector USB/Bluetooth o pulsa "Cámara" para usar la cámara.',
      'Si un producto no tiene código, búscalo por nombre en el buscador del POS.',
      'Elige Efectivo o Transferencia, cobra e imprime o descarga el comprobante.',
    ],
    target: 'pos',
    ctaLabel: 'Ir a Punto de Venta POS',
  },
  {
    title: '3. Mapa de entregas y GPS en tiempo real',
    summary: 'Supervisa a tus repartidores o inicia tu ruta de entrega.',
    bullets: [
      'Administradores y encargados ven todas las entregas activas, pendientes y retrasadas (>40 min).',
      'El Repartidor abre su pedido, pulsa "Iniciar entrega (Activar GPS)" y puede abrir Google Maps con 1 toque.',
    ],
    target: 'deliveries',
    ctaLabel: 'Abrir Mapa de entregas',
  },
  {
    title: '4. Control de inventario y códigos de barras',
    summary: 'Mantén al día existencias, precios y entradas de mercadería.',
    bullets: [
      'En "Productos e inventario" puedes crear productos y asignar varios códigos de barras o códigos internos.',
      'Usa "Registrar entrada / conteo" escaneando productos cuando llega mercadería o haces inventario físico.',
    ],
    target: 'inventory',
    ctaLabel: 'Ir a Inventario',
  },
  {
    title: '5. Control de caja y reportes',
    summary: 'Lleva el arqueo diario y exporta ventas a Excel o PDF.',
    bullets: [
      'En "Control de caja" abre turno con tu fondo inicial, registra gastos y realiza el cierre.',
      'En "Reportes" filtra fechas y descarga reportes en Excel o PDF.',
    ],
    target: 'cash',
    ctaLabel: 'Ir a Control de caja',
  },
];

export const HelpAssistant: React.FC<HelpAssistantProps> = ({
  mode,
  currentScreen,
  userRole,
  userName,
  cartCount = 0,
  allowedAdminTabs,
  onNavigate,
}) => {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'chat' | 'tour'>('chat');
  const [tourIndex, setTourIndex] = useState(0);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  const initialGreeting: ChatMessage = useMemo(
    () => ({
      id: 'welcome',
      role: 'assistant',
      text:
        mode === 'admin'
          ? `¡Hola${userName ? ` ${userName.split(' ')[0]}` : ''}! Soy Patty, tu asistente del sistema. Si es tu primera vez usando este panel, dime qué tarea quieres hacer y te guío paso a paso.`
          : `¡Hola${userName ? ` ${userName.split(' ')[0]}` : ''}! Soy Patty, tu asistente de Los Patrones Mini Market. Si no sabes cómo comprar, pagar o rastrear tu pedido, pregúntame sin pena y te explico paso a paso.`,
      steps:
        mode === 'admin'
          ? [
              'Toca una pregunta rápida abajo o escribe lo que necesitas hacer.',
              'Si prefieres ver todo en orden, abre la pestaña "Guía paso a paso" arriba.',
            ]
          : [
              'Pregúntame cómo buscar productos, hacer un pedido, pagar o ver el mapa.',
              'También puedes abrir la pestaña "Guía paso a paso" arriba para ver un tutorial rápido.',
            ],
      suggested_questions:
        mode === 'admin'
          ? userRole === 'Repartidor'
            ? [
                '¿Cómo inicio una entrega con GPS?',
                '¿Cómo abro la ruta en Google Maps?',
                '¿Qué hago al entregar el pedido?',
              ]
            : [
                '¿Cómo cobro una venta en el POS?',
                '¿Cómo acepto y asigno un pedido en línea?',
                '¿Cómo agrego un producto con código de barras?',
              ]
          : [
              '¿Cómo hago mi primer pedido?',
              '¿Cuál es el horario y monto mínimo?',
              '¿Cómo sigo mi pedido en el mapa?',
            ],
    }),
    [mode, userName, userRole]
  );

  const [messages, setMessages] = useState<ChatMessage[]>([initialGreeting]);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setMessages([initialGreeting]);
    setTourIndex(0);
  }, [mode]);

  useEffect(() => {
    if (open && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading, open, tab]);

  const activeTourSteps = useMemo(() => {
    if (mode === 'store') return STORE_TOUR;
    if (!allowedAdminTabs || allowedAdminTabs.length === 0) return ADMIN_TOUR;
    const filtered = ADMIN_TOUR.filter((s) => allowedAdminTabs.includes(s.target));
    return filtered.length > 0 ? filtered : ADMIN_TOUR;
  }, [mode, allowedAdminTabs]);

  const safeTourStep = activeTourSteps[Math.min(tourIndex, activeTourSteps.length - 1)] || activeTourSteps[0];

  const handleActionClick = (target: string) => {
    if (mode === 'admin' && allowedAdminTabs && !allowedAdminTabs.includes(target)) {
      return;
    }
    onNavigate(target);
    if (window.innerWidth < 768) {
      setOpen(false);
    }
  };

  const sendMessage = async (questionText?: string) => {
    const text = (questionText ?? input).trim();
    if (!text || loading) return;

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      text,
    };

    const historyForApi = messages
      .filter((m) => !m.isError)
      .slice(-8)
      .map((m) => ({ role: m.role, text: m.text }));

    setMessages((prev) => [...prev, userMsg]);
    if (!questionText) setInput('');
    setLoading(true);
    setTab('chat');

    try {
      const res = await apiFetch<{
        reply: string;
        steps?: string[];
        suggested_questions?: string[];
        action?: AssistantAction;
      }>('/api/assistant/chat', {
        method: 'POST',
        body: JSON.stringify({
          message: text,
          history: historyForApi,
          context: {
            mode,
            screen: currentScreen,
            role: userRole || 'Cliente',
            cartCount,
          },
        }),
      });

      setMessages((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: 'assistant',
          text: res.reply,
          steps: res.steps || [],
          suggested_questions: res.suggested_questions || [],
          action: res.action,
        },
      ]);
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          role: 'assistant',
          text:
            err?.message ||
            'No pude conectarme con la asistente inteligente en este momento. Puedes usar la pestaña "Guía paso a paso" aquí arriba para aprender todas las funciones.',
          isError: true,
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {/* Floating Assistant Launcher */}
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Abrir asistente de ayuda"
          className="fixed bottom-5 right-5 z-40 no-print flex items-center gap-2.5 pl-3.5 pr-4 py-3 rounded-2xl bg-[#2054C9] hover:bg-[#1943A3] text-white shadow-xl border-2 border-[#F9D94A] transition-transform hover:scale-[1.03] active:scale-[0.98]"
        >
          <span className="w-8 h-8 rounded-xl bg-[#F9D94A] text-[#202633] flex items-center justify-center shrink-0">
            <HelpCircle className="w-5 h-5" />
          </span>
          <div className="text-left leading-tight">
            <span className="block text-[10px] font-semibold uppercase tracking-wider text-[#F9D94A]">
              Asistente virtual
            </span>
            <span className="block text-xs sm:text-sm font-bold text-white whitespace-nowrap">
              ¿No sabes cómo usarla?
            </span>
          </div>
        </button>
      )}

      {/* Assistant Drawer */}
      {open && (
        <div className="fixed inset-0 z-50 flex justify-end bg-[#202633]/40 backdrop-blur-[1px] no-print">
          <div className="w-full max-w-md bg-white h-full flex flex-col shadow-2xl border-l border-[#202633]/15">
            {/* Header */}
            <div className="bg-[#2054C9] text-white px-5 py-4 flex items-center justify-between">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-xl bg-[#F9D94A] text-[#202633] flex items-center justify-center shrink-0">
                  <Sparkles className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <h2 className="font-display text-2xl tracking-wide leading-none text-white">
                    Patty · Asistente Guiado
                  </h2>
                  <p className="text-[11px] text-white/80 mt-0.5 truncate">
                    {mode === 'admin'
                      ? `Ayuda para ${userRole || 'Personal'} · Paso a paso`
                      : 'Te ayudo a comprar, pagar y rastrear paso a paso'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setMessages([initialGreeting])}
                  title="Reiniciar conversación"
                  className="p-2 rounded-lg text-white/80 hover:text-white hover:bg-white/10"
                >
                  <RotateCcw className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Cerrar asistente"
                  className="p-2 rounded-lg text-white/80 hover:text-white hover:bg-white/10"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Sub-tabs: Chat vs Step-by-step Visual Guide */}
            <div className="grid grid-cols-2 bg-[#FFF4E5] border-b border-[#202633]/12 p-1.5 gap-1.5">
              <button
                type="button"
                onClick={() => setTab('chat')}
                className={`flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-bold transition-colors ${
                  tab === 'chat'
                    ? 'bg-white text-[#2054C9] shadow-sm border border-[#202633]/10'
                    : 'text-[#202633]/70 hover:text-[#202633]'
                }`}
              >
                <MessageSquareHeart className="w-4 h-4" />
                Preguntar a Patty
              </button>
              <button
                type="button"
                onClick={() => setTab('tour')}
                className={`flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-bold transition-colors ${
                  tab === 'tour'
                    ? 'bg-white text-[#2054C9] shadow-sm border border-[#202633]/10'
                    : 'text-[#202633]/70 hover:text-[#202633]'
                }`}
              >
                <Compass className="w-4 h-4" />
                Guía paso a paso
              </button>
            </div>

            {tab === 'tour' ? (
              <div className="flex-1 overflow-y-auto p-5 flex flex-col justify-between gap-5 bg-[#FFF4E5]/40">
                <div className="space-y-4">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-[#2054C9] uppercase tracking-wider">
                      Tutorial rápido ({tourIndex + 1} de {activeTourSteps.length})
                    </span>
                    <div className="flex items-center gap-1">
                      {activeTourSteps.map((s, idx) => (
                        <button
                          key={s.title}
                          type="button"
                          onClick={() => setTourIndex(idx)}
                          aria-label={`Paso ${idx + 1}`}
                          className={`h-2 rounded-full transition-all ${
                            idx === tourIndex ? 'w-6 bg-[#2054C9]' : 'w-2 bg-[#202633]/20 hover:bg-[#202633]/40'
                          }`}
                        />
                      ))}
                    </div>
                  </div>

                  <div className="bg-white border border-[#202633]/12 rounded-2xl p-5 space-y-4 shadow-sm">
                    <div>
                      <h3 className="text-lg font-bold text-[#202633] font-sans leading-snug">
                        {safeTourStep.title}
                      </h3>
                      <p className="text-xs text-[#202633]/70 mt-1">{safeTourStep.summary}</p>
                    </div>

                    <div className="space-y-2.5">
                      {safeTourStep.bullets.map((b, i) => (
                        <div
                          key={i}
                          className="flex items-start gap-2.5 p-2.5 rounded-xl bg-[#FFF4E5]/70 border border-[#202633]/8"
                        >
                          <span className="w-5 h-5 rounded-md bg-[#2054C9] text-white text-[11px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                            {i + 1}
                          </span>
                          <p className="text-xs text-[#202633] leading-relaxed">{b}</p>
                        </div>
                      ))}
                    </div>

                    <button
                      type="button"
                      onClick={() => handleActionClick(safeTourStep.target)}
                      className="w-full py-2.5 px-4 bg-[#13B64B] hover:bg-[#10A041] text-[#202633] font-bold text-xs rounded-xl flex items-center justify-center gap-2 transition-colors"
                    >
                      {safeTourStep.ctaLabel}
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="bg-white border border-[#202633]/12 rounded-xl p-4 space-y-2">
                    <p className="text-[11px] font-bold text-[#202633]/70 uppercase tracking-wider">
                      Ir directo a un tema
                    </p>
                    <div className="grid grid-cols-1 gap-1.5">
                      {activeTourSteps.map((s, idx) => (
                        <button
                          key={s.title}
                          type="button"
                          onClick={() => setTourIndex(idx)}
                          className={`text-left px-3 py-2 rounded-lg text-xs font-semibold transition-colors ${
                            idx === tourIndex
                              ? 'bg-[#2054C9]/10 text-[#2054C9]'
                              : 'hover:bg-[#FFF4E5] text-[#202633]/80'
                          }`}
                        >
                          {s.title}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2 pt-2 border-t border-[#202633]/10">
                  <button
                    type="button"
                    disabled={tourIndex === 0}
                    onClick={() => setTourIndex((i) => Math.max(0, i - 1))}
                    className="inline-flex items-center gap-1 px-3.5 py-2 rounded-lg border border-[#202633]/15 bg-white text-xs font-semibold text-[#202633] disabled:opacity-40"
                  >
                    <ChevronLeft className="w-4 h-4" />
                    Anterior
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      tourIndex < activeTourSteps.length - 1
                        ? setTourIndex((i) => i + 1)
                        : setTab('chat')
                    }
                    className="inline-flex items-center gap-1 px-4 py-2 rounded-lg bg-[#2054C9] hover:bg-[#1943A3] text-white text-xs font-semibold"
                  >
                    {tourIndex < activeTourSteps.length - 1 ? 'Siguiente paso' : 'Hacer una pregunta'}
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ) : (
              <>
                {/* Chat Messages */}
                <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4 bg-[#FFF4E5]/35">
                  {messages.map((m) => (
                    <div
                      key={m.id}
                      className={`flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'}`}
                    >
                      <div
                        className={`max-w-[90%] rounded-2xl px-4 py-3 text-xs leading-relaxed shadow-sm ${
                          m.role === 'user'
                            ? 'bg-[#2054C9] text-white rounded-br-sm'
                            : m.isError
                              ? 'bg-red-50 border border-red-200 text-red-900 rounded-bl-sm'
                              : 'bg-white border border-[#202633]/12 text-[#202633] rounded-bl-sm'
                        }`}
                      >
                        <p className="font-medium">{m.text}</p>

                        {m.steps && m.steps.length > 0 && (
                          <div className="mt-3 space-y-1.5">
                            {m.steps.map((step, idx) => (
                              <div
                                key={idx}
                                className="flex items-start gap-2 p-2 rounded-lg bg-[#FFF4E5]/75 border border-[#202633]/8"
                              >
                                <span className="w-4 h-4 rounded bg-[#2054C9] text-white text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                                  {idx + 1}
                                </span>
                                <span className="text-[11px] text-[#202633]">
                                  {step.replace(/^\d+[\.\)]\s*/, '')}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}

                        {m.action && (
                          <button
                            type="button"
                            onClick={() => handleActionClick(m.action!.target)}
                            className="mt-3 w-full py-2 px-3 rounded-lg bg-[#13B64B] hover:bg-[#10A041] text-[#202633] font-bold text-xs flex items-center justify-center gap-1.5 transition-colors"
                          >
                            {m.action.label}
                            <ArrowRight className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>

                      {m.role === 'assistant' && m.suggested_questions && m.suggested_questions.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5 max-w-[95%]">
                          {m.suggested_questions.map((q) => (
                            <button
                              key={q}
                              type="button"
                              disabled={loading}
                              onClick={() => sendMessage(q)}
                              className="text-left px-2.5 py-1.5 rounded-lg bg-white hover:bg-[#F9D94A]/30 border border-[#2054C9]/25 text-[#2054C9] text-[11px] font-semibold transition-colors disabled:opacity-50"
                            >
                              {q}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}

                  {loading && (
                    <div className="flex items-start">
                      <div className="bg-white border border-[#202633]/12 rounded-2xl rounded-bl-sm px-4 py-3 text-xs text-[#202633]/70">
                        Patty está preparando tus pasos...
                      </div>
                    </div>
                  )}
                </div>

                {/* Chat Composer */}
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    sendMessage();
                  }}
                  className="p-3 bg-white border-t border-[#202633]/12 flex items-center gap-2"
                >
                  <input
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="Escribe tu duda aquí (ej. ¿Cómo pido?)..."
                    className="flex-1 px-3.5 py-2.5 text-xs bg-[#FFF4E5]/50 border border-[#202633]/20 rounded-xl text-[#202633] focus:outline-none focus:ring-2 focus:ring-[#2054C9]"
                  />
                  <button
                    type="submit"
                    disabled={loading || !input.trim()}
                    aria-label="Enviar pregunta"
                    className="px-3.5 py-2.5 bg-[#2054C9] hover:bg-[#1943A3] disabled:opacity-50 text-white rounded-xl font-semibold text-xs inline-flex items-center gap-1.5 shrink-0"
                  >
                    <Send className="w-4 h-4" />
                    Enviar
                  </button>
                </form>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
};
