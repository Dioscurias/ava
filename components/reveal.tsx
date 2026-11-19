"use client";
import { motion, useReducedMotion } from "framer-motion";

export function Reveal({children}: {children: React.ReactNode}) {
  const reduced = useReducedMotion();
  return <motion.div initial={{opacity: 1, y: reduced ? 0 : 12}} whileInView={{y: 0}} viewport={{once: true, amount: .15}} transition={{duration: .55}}>{children}</motion.div>;
}
