# MSDatabase — Espectros EM, IR y RMN con interpretación

Herramienta docente (Escuela de Química, UNACHI) que reúne espectros experimentales de un compuesto
orgánico —EM por impacto electrónico (MassBank), IR (NIST WebBook), RMN ¹H y ¹³C (PubChem/HMDB y
NMRShiftDB2)— buscándolo por nombre, número CAS, InChIKey o estructura dibujada en JSME, y los interpreta:

- **EM**: mecanismos de fragmentación de los picos observados (motor de PGBeermann/masas), ion molecular,
  regla del N, isótopos y pérdidas neutras.
- **IR**: bandas asignadas a los grupos funcionales de la estructura.
- **RMN**: entornos equivalentes, δ estimados, multiplicidad, integración y asignación de señales.
- **Análisis conjunto** de las cuatro técnicas.

Instalación, despliegue con Dokploy, API y fundamentos: ver [LEEME.md](LEEME.md).

Las capturas `int_*.png` muestran la interfaz con espectros **simulados** de prueba, no con datos reales.
