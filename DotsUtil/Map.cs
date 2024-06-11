using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Drawing;

namespace DotsUtil
{
    class Map
    {
        
        delegate bool ColorCompair(Color l, Color r);
        private bool[,] _Mp;
        Map(int x)
        {
            _Mp = new bool[x, x];
        }

        Map(Image I, ColorCompair Cfn)
        {
            for (int x = 0; x < I.Width; x++)
            {
                for (int y = 0; y < I.Height; y++)
                {

                }

            }
        }

    }
}
