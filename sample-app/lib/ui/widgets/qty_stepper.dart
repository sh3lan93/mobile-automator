import 'package:flutter/material.dart';

class QtyStepper extends StatelessWidget {
  const QtyStepper({
    super.key,
    required this.qty,
    required this.onInc,
    required this.onDec,
  });

  final int qty;
  final VoidCallback onInc;
  final VoidCallback onDec;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Semantics(
          identifier: 'product_stepper_qty_dec',
          button: true,
          child: IconButton(
              onPressed: onDec, icon: const Icon(Icons.remove)),
        ),
        Semantics(
          identifier: 'product_stepper_qty_value',
          child: Text('$qty', style: const TextStyle(fontSize: 18)),
        ),
        Semantics(
          identifier: 'product_stepper_qty_inc',
          button: true,
          child:
              IconButton(onPressed: onInc, icon: const Icon(Icons.add)),
        ),
      ],
    );
  }
}
